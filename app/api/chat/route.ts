export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: NextRequest) {
  try {
    const { message, customerId, policies = [], lastPolicyId, clarification } =
      await req.json();

    let selectedPolicyId = lastPolicyId;

    // -------------------------------------------------
    // 1. POLICY SELECTION USING GPT
    // -------------------------------------------------
    if (!selectedPolicyId && !clarification) {
      const choosePrompt = `
A customer asked: "${message}"

Here are the available policies:

${policies
  .map(
    (p, i) =>
      `#${i + 1}: Policy ID: ${p.id}, File: ${p.file_name}, Insurer: ${
        p.insurer
      }, Wording Version: ${p.wording_version}`
  )
  .join("\n")}

TASK:
Return ONLY JSON:

If clear:
{
  "policyId": "<id>",
  "needs_clarification": false,
  "clarification_question": null
}

If not clear:
{
  "policyId": null,
  "needs_clarification": true,
  "clarification_question": "Which policy are you asking about?"
}
`;

      const ai = await openai.chat.completions.create({
        model: "gpt-5.1-mini",
        temperature: 0,
        messages: [{ role: "user", content: choosePrompt }],
      });

      let raw = ai.choices[0].message?.content ?? "{}";
      raw = raw.replace(/```json/gi, "").replace(/```/g, "").trim();

      let parsed: any = {};
      try {
        parsed = JSON.parse(raw);
      } catch {
        return NextResponse.json({
          clarification: true,
          question: "Which policy are you asking about?",
        });
      }

      if (parsed.needs_clarification) {
        return NextResponse.json({
          clarification: true,
          question: parsed.clarification_question,
        });
      }

      selectedPolicyId = parsed.policyId;
    }

    // -------------------------------------------------
    // 2. LOAD POLICY SCHEDULE
    // -------------------------------------------------
    const { data: policy } = await supabase
      .from("policies")
      .select("ocr_text, wording_id")
      .eq("id", selectedPolicyId)
      .single();

    if (!policy) {
      return NextResponse.json(
        { error: "Policy not found" },
        { status: 404 }
      );
    }

    let scheduleJSON: any = {};
    try {
      scheduleJSON = JSON.parse(policy.ocr_text);
    } catch {
      scheduleJSON = { text: policy.ocr_text };
    }

    // -------------------------------------------------
    // 3. LOAD WORDING + COMPARISON JSON
    // -------------------------------------------------
    let wordingText = "";
    let comparisonJSON = null;

    if (policy.wording_id) {
      const { data: wording } = await supabase
        .from("policy_wording")
        .select("wording_text")
        .eq("id", policy.wording_id)
        .single();

      wordingText = wording?.wording_text ?? "";

      const { data: comp } = await supabase
        .from("analysis")
        .select("result_json")
        .eq("policy_id", selectedPolicyId)
        .order("id", { ascending: false })
        .limit(1)
        .single();

      comparisonJSON = comp?.result_json ?? null;
    }

    // -------------------------------------------------
    // 4. BUILD FINAL PROMPT FOR GPT-5.1-mini
    // -------------------------------------------------
    const MAX = 20000;

    const finalPrompt = `
You are VINK — an insurance assistant for brokers.

RULES:
- Use ONLY the following: SCHEDULE_JSON, WORDING_TEXT, COMPARISON_JSON.
- If missing, say: "This information is not present in the schedule or wording."
- Prefer SCHEDULE for limits/deductibles.
- Prefer WORDING for definitions.
- Keep answers short and factual.

SCHEDULE_JSON:
${JSON.stringify(scheduleJSON).slice(0, MAX)}

WORDING_TEXT:
${wordingText.slice(0, MAX)}

COMPARISON_JSON:
${JSON.stringify(comparisonJSON).slice(0, MAX)}

USER QUESTION:
"${message}"
`;

    // -------------------------------------------------
    // 5. ASK GPT-5.1-mini
    // -------------------------------------------------
    const answerRes = await openai.chat.completions.create({
      model: "gpt-5.1-mini",
      temperature: 0,
      messages: [{ role: "user", content: finalPrompt }],
    });

    const answer =
      answerRes.choices[0].message?.content ??
      "I'm sorry — I could not generate an answer.";

    return NextResponse.json({
      success: true,
      answer,
      selectedPolicyId,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: "Chat error", details: err.message },
      { status: 500 }
    );
  }
}
