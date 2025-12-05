export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

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
    // 1. POLICY SELECTION LOGIC (uses GPT-5.1-mini)
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
Return ONLY ONE JSON object.

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

      const resp = await openai.responses.create({
        model: "gpt-5.1-mini",
        input: [
          {
            type: "message",
            role: "user",
            content: choosePrompt,
          },
        ],
      });

      let raw = resp.output_text ?? "{}";
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
    // 4. GPT-5.1-mini ANALYSIS PROMPT
    // -------------------------------------------------
    const MAX = 20000;

    const inputBlocks = [
      // System
      {
        type: "message",
        role: "system",
        content: `
You are VINK — an insurance assistant for brokers.
Use ONLY the provided Schedule JSON, Wording Text, and Comparison JSON.
If information is missing, say:
"This information is not present in the schedule or wording."
Keep responses short and factual.
`,
      },

      // Schedule
      {
        type: "message",
        role: "user",
        content: "SCHEDULE_JSON:\n" + JSON.stringify(scheduleJSON).slice(0, MAX),
      },

      // Wording
      {
        type: "message",
        role: "user",
        content: "WORDING_TEXT:\n" + wordingText.slice(0, MAX),
      },

      // Comparison
      {
        type: "message",
        role: "user",
        content:
          "COMPARISON_JSON:\n" +
          JSON.stringify(comparisonJSON).slice(0, MAX),
      },

      // User question
      {
        type: "message",
        role: "user",
        content: `USER QUESTION: ${message}`,
      },
    ];

    // -------------------------------------------------
    // 5. CALL GPT-5.1-mini
    // -------------------------------------------------
    const ai = await openai.responses.create({
      model: "gpt-5.1-mini",
      input: inputBlocks,
      max_output_tokens: 300,
    });

    const answer =
      ai.output_text ?? "I'm sorry — I could not generate an answer.";

    // -------------------------------------------------
    // 6. SEND BACK TO UI
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
