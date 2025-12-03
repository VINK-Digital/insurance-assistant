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
    const { message, customerId, policies, lastPolicyId, clarification } =
      await req.json();

    // -------------------------------
    // 1. If a policyId was already chosen earlier, use it
    // -------------------------------
    let selectedPolicyId = lastPolicyId;

    // -------------------------------
    // 2. If no policy locked in, ask GPT to choose which policy user refers to
    // -------------------------------
    if (!selectedPolicyId && !clarification) {
      const choosePrompt = `
A customer asked: "${message}"
Here are the available policies:

${policies
  .map(
    (p: any, i: number) =>
      `#${i + 1} - Policy ID: ${p.id}, File: ${p.file_name}, Insurer: ${
        p.insurer
      }, Wording Version: ${p.wording_version}`
  )
  .join("\n")}

TASK:
Return JSON ONLY.
{
  "policyId": "<id-of-policy>",
  "needs_clarification": false,
  "clarification_question": null
}

If the question is ambiguous:
{
  "policyId": null,
  "needs_clarification": true,
  "clarification_question": "Which policy are you asking about: X or Y?"
}
`;

      const selection = await openai.responses.create({
        model: "gpt-5-mini",
        input: choosePrompt,
      });

      let out = selection.output_text ?? "{}";
      out = out.replace(/```json/gi, "").replace(/```/g, "").trim();
      const parsed = JSON.parse(out);

      if (parsed.needs_clarification) {
        return NextResponse.json({
          clarification: true,
          question: parsed.clarification_question,
        });
      }

      selectedPolicyId = parsed.policyId;
    }

    // -------------------------------
    // 3. Load POLICY SCHEDULE JSON from Supabase (ocr_text)
    // -------------------------------
    const { data: schedulePolicy } = await supabase
      .from("policies")
      .select("ocr_text, wording_id")
      .eq("id", selectedPolicyId)
      .single();

    if (!schedulePolicy) {
      return NextResponse.json(
        { error: "Policy not found in database." },
        { status: 404 }
      );
    }

    let scheduleJSON: any = null;
    try {
      scheduleJSON = JSON.parse(schedulePolicy.ocr_text);
    } catch {
      scheduleJSON = { text: schedulePolicy.ocr_text };
    }

    // -------------------------------
    // 4. Load WORDING TEXT + COMPARISON JSON
    // -------------------------------
    let wordingText = "";
    let comparisonJSON: any = null;

    if (schedulePolicy.wording_id) {
      const { data: wording } = await supabase
        .from("policy_wording")
        .select("wording_text")
        .eq("id", schedulePolicy.wording_id)
        .single();

      if (wording?.wording_text) {
        wordingText = wording.wording_text;
      }

      const { data: comparison } = await supabase
        .from("analysis")
        .select("result_json")
        .eq("policy_id", selectedPolicyId)
        .order("id", { ascending: false })
        .limit(1)
        .single();

      if (comparison?.result_json) {
        comparisonJSON = comparison.result_json;
      }
    }

    // -------------------------------
// -------------------------------
// 5. Now answer question using STRICT GROUNDED DATA
const answerPrompt = `
You are an insurance assistant for brokers.

DATA YOU MAY USE:
- POLICY SCHEDULE JSON (includes tables, limits, deductibles, etc.)
- POLICY WORDING TEXT (full wording 11.20 etc.)
- COMPARISON JSON (pre-computed differences between schedule and wording)

RULES:
- Answer ONLY using these data sources.
- If something is not in the data, explicitly say: "This is not in the schedule/wording I have."
- Do NOT guess or hallucinate.
- Prefer the wording text for definitions and clause meaning.
- Prefer the schedule JSON for actual insured limits, deductibles, and sub-limits.

STYLE:
- Be concise and practical.
- 2–3 short paragraphs max OR a short bullet list.
- When explaining a clause, write in plain English (3–5 sentences).
- Always mention limits & deductibles if relevant.

POLICY SCHEDULE JSON:
${JSON.stringify(scheduleJSON, null, 2)}

POLICY WORDING TEXT (may include clauses like 2.2(b) Crime):
${wordingText.slice(0, 20000)}

COMPARISON RESULT JSON (if available):
${JSON.stringify(comparisonJSON, null, 2)}

User question:
"${message}"
`;

// Call GPT to generate grounded answer
const final = await openai.responses.create({
  model: "gpt-5-mini",
  input: answerPrompt,
});

const answer =
  final.output_text ?? "I'm sorry, I could not produce an answer.";

return NextResponse.json({
  success: true,
  answer,
  selectedPolicyId,
});
