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
    // 1. If no policy selected and this is not a clarification,
    // ask GPT to pick one
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
Return JSON strictly in this format:

If the question clearly refers to one policy:
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
        input: choosePrompt,
      });

      let raw = chooseResponse.output_text ?? "{}";
      raw = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
      const parsed = JSON.parse(raw);

      if (parsed.needs_clarification) {
        return NextResponse.json({
          clarification: true,
          question: parsed.clarification_question,
        });
      }

      selectedPolicyId = parsed.policyId;
    }

    // -------------------------------------------------
    // 2. Load policy schedule from Supabase
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

    let scheduleJSON: any = null;
    try {
      scheduleJSON = JSON.parse(policy.ocr_text);
    } catch {
      scheduleJSON = { text: policy.ocr_text };
    }

    // -------------------------------------------------
    // 3. Load wording text + comparison JSON (if exists)
    // -------------------------------------------------
    let wordingText = "";
    let comparisonJSON = null;

    if (policy.wording_id) {
      const { data: wording } = await supabase
        .from("policy_wording")
        .select("wording_text")
        .eq("id", policy.wording_id)
        .single();

      if (wording?.wording_text) {
        wordingText = wording.wording_text;
      }

      const { data: comp } = await supabase
        .from("analysis")
        .select("result_json")
        .eq("policy_id", selectedPolicyId)
        .order("id", { ascending: false })
        .limit(1)
        .single();

      if (comp?.result_json) {
        comparisonJSON = comp.result_json;
      }
    }

    // -------------------------------------------------
    // 4. Build grounded answer prompt
    // -------------------------------------------------
    const answerPrompt = `
You are an insurance assistant for brokers.

DATA YOU MAY USE:
- POLICY SCHEDULE JSON (tables, limits, deductibles)
- POLICY WORDING TEXT (full legal wording)
- COMPARISON JSON (schedule vs wording differences)

RULES:
- Answer ONLY using this data.
- If something is NOT in the data, say:
  "This information is not present in the schedule or wording."
- DO NOT guess.
- DO NOT hallucinate.
- Prefer the wording for definitions.
- Prefer the schedule for limits/deductibles/sections.

STYLE:
- Be concise.
- Max 2 short paragraphs or bullet points.
- If user asks “what does clause 2.2(b) mean?”
   → Give a simple 3–5 sentence plain-English summary.
- Mention limits & deductibles when relevant.

SCHEDULE_JSON:
${JSON.stringify(scheduleJSON, null, 2)}

WORDING_TEXT:
${wordingText.slice(0, 20000)}

COMPARISON_JSON:
${JSON.stringify(comparisonJSON, null, 2)}

USER QUESTION:
"${message}"
`;

    // -------------------------------------------------
    // 5. Generate grounded answer
    // -------------------------------------------------
    const aiResponse = await openai.responses.create({
      model: "gpt-5-mini",
      input: answerPrompt,
    });

    const answer =
      aiResponse.output_text ??
      "I'm sorry — I could not generate an answer.";

    // -------------------------------------------------
    // 6. Return answer to frontend
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
