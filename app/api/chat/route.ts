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
    // 1. CHOOSE POLICY IF NOT SELECTED
    // -------------------------------------------------
    if (!selectedPolicyId && !clarification) {
      const choosePrompt = `
A customer asked: "${message}"

Here are the available policies:

${policies
  .map(
    (p: any, i: number) =>
      `#${i + 1}: Policy ID: ${p.id}, File: ${p.file_name}, Insurer: ${
        p.insurer
      }, Wording Version: ${p.wording_version}`
  )
  .join("\n")}

TASK:
Return strict JSON ONLY:

If clear:
{
  "policyId": "<id>",
  "needs_clarification": false,
  "clarification_question": null
}

If ambiguous:
{
  "policyId": null,
  "needs_clarification": true,
  "clarification_question": "Which policy are you asking about?"
}
`;

      const chooseResponse = await openai.responses.create({
        model: "gpt-5-mini",
        input: [{ role: "user", content: [{ type: "input_text", text: choosePrompt }] }],
      });

      let raw = chooseResponse.output_text ?? "{}";

      // clean markdown
      raw = raw.replace(/```json/gi, "").replace(/```/g, "");

      let parsed: any = {};
      try {
        parsed = JSON.parse(raw);
      } catch {
        return NextResponse.json(
          {
            clarification: true,
            question: "Which policy are you asking about?",
          },
          { status: 200 }
        );
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
    // 2. LOAD POLICY DATA
    // -------------------------------------------------
    const { data: policy } = await supabase
      .from("policies")
      .select("ocr_text, wording_id")
      .eq("id", selectedPolicyId)
      .single();

    if (!policy) {
      return NextResponse.json({ error: "Policy not found" }, { status: 404 });
    }

    let scheduleJSON: any = {};
    try {
      scheduleJSON = JSON.parse(policy.ocr_text);
    } catch {
      scheduleJSON = { text: policy.ocr_text };
    }

    // -------------------------------------------------
    // 3. LOAD WORDING + COMPARISON
    // -------------------------------------------------
    let wordingText = "";
    let comparisonJSON: any = null;

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
    // 4. BUILD GPT INPUT (STRUCTURED, SAFE)
    // -------------------------------------------------
    const MAX_CHARS = 20000; // prevent model overflow

    const inputBlocks = [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text: `
You are VINK — an insurance assistant for brokers.

RULES:
- Only answer using the provided Schedule, Wording Text, and Comparison JSON.
- If missing: say "This information is not present in the schedule or wording."
- Prefer SCHEDULE for limits/deductibles.
- Prefer WORDING for definitions.
- Keep responses to 2 short paragraphs or bullet points.
        `,
          },
        ],
      },
      {
        role: "user",
        content: [
          { type: "input_text", text: "SCHEDULE_JSON:" },
          {
            type: "input_text",
            text: JSON.stringify(scheduleJSON).slice(0, MAX_CHARS),
          },

          { type: "input_text", text: "WORDING_TEXT:" },
          { type: "input_text", text: wordingText.slice(0, MAX_CHARS) },

          { type: "input_text", text: "COMPARISON_JSON:" },
          {
            type: "input_text",
            text: JSON.stringify(comparisonJSON).slice(0, MAX_CHARS),
          },

          { type: "input_text", text: `USER QUESTION: ${message}` },
        ],
      },
    ];

    // -------------------------------------------------
    // 5. ASK GPT
    // -------------------------------------------------
    const aiResponse = await openai.responses.create({
      model: "gpt-5-mini",
      input: inputBlocks,
    });

    const answer =
      aiResponse.output_text ??
      "I’m sorry — I could not generate an answer.";

    // -------------------------------------------------
    // 6. RETURN ANSWER
    // -------------------------------------------------
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
