export const dynamic = "force-dynamic";
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
    const {
      message,
      customerId,
      policies = [],
      lastPolicyId,
      clarification,
    } = await req.json();

    let selectedPolicyId = lastPolicyId;

    // -------------------------------------------------
    // 1. GPT POLICY SELECTION — NOW UUID SAFE
    // -------------------------------------------------
    if (!selectedPolicyId && !clarification) {
      const choosePrompt = `
A customer asked: "${message}"

Here are the available policies (each includes its TRUE UUID):

${policies
  .map(
    (p: any, i: number) =>
      `Policy ${i + 1}:
UUID="${p.id}"
File="${p.file_name}"
Insurer="${p.insurer}"
Version="${p.wording_version}"`
  )
  .join("\n\n")}

RULES:
- ALWAYS return the exact UUID field shown above.
- NEVER return the index number (1, 2, etc.).
- NEVER return "#1", "Policy 1", or anything except the UUID string.

Return ONLY one JSON object:

If clear:
{ "policyId": "<UUID>", "needs_clarification": false }

If unclear:
{ "policyId": null, "needs_clarification": true,
  "clarification_question": "Which policy are you asking about?" }
`;

      const chooseResp = await openai.responses.create({
        model: "gpt-5-mini",
        input: choosePrompt,
        max_output_tokens: 100,
      });

      let raw = chooseResp.output_text || "{}";
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

      // If GPT asks for clarification
      if (parsed.needs_clarification) {
        return NextResponse.json({
          clarification: true,
          question: parsed.clarification_question,
        });
      }

      selectedPolicyId = parsed.policyId;
    }

    // -------------------------------------------------
    // 2. LOAD POLICY + WORDING FROM SUPABASE
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

    let scheduleJSON: any;

    try {
      scheduleJSON = JSON.parse(policy.ocr_text);
    } catch {
      scheduleJSON = { text: policy.ocr_text };
    }

    let wordingText = "";
    let comparisonJSON = null;

    if (policy.wording_id) {
      const { data: wording } = await supabase
        .from("policy_wording")
        .select("wording_text")
        .eq("id", policy.wording_id)
        .single();

      wordingText = wording?.wording_text || "";

      const { data: comp } = await supabase
        .from("analysis")
        .select("result_json")
        .eq("policy_id", selectedPolicyId)
        .order("id", { ascending: false })
        .limit(1)
        .single();

      comparisonJSON = comp?.result_json || null;
    }

    // -------------------------------------------------
    // 3. BUILD GPT ANSWER PROMPT
    // -------------------------------------------------
    const MAX = 20000;

    const finalPrompt = `
You are VINK — an insurance assistant for brokers.

RULES:
- Use ONLY the schedule, wording text, and comparison JSON.
- If something is missing, say:
  "This information is not present in the schedule or wording."
- Keep answers concise.

---

SCHEDULE_JSON:
${JSON.stringify(scheduleJSON).slice(0, MAX)}

---

WORDING_TEXT:
${wordingText.slice(0, MAX)}

---

COMPARISON_JSON:
${JSON.stringify(comparisonJSON).slice(0, MAX)}

---

USER QUESTION:
${message}

Answer using only the above information.
`;

    // -------------------------------------------------
    // 4. GPT ANSWER
    // -------------------------------------------------
    const resp = await openai.responses.create({
      model: "gpt-5-mini",
      input: finalPrompt,
      max_output_tokens: 400,
    });

    const answer =
      resp.output_text || "I'm sorry — I could not generate an answer.";

    return NextResponse.json({
      success: true,
      answer,
      selectedPolicyId,
    });
  } catch (err: any) {
    console.error("CHAT ERROR:", err);
    return NextResponse.json(
      { error: "Chat error", details: err.message },
      { status: 500 }
    );
  }
}
