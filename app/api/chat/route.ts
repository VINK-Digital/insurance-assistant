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
    // 5. Now answer question using STRICT GROUNDED DATA
    // -------------------------------
    const answerPrompt = `
You are an insurance assistant. 
ANSWER USING ONLY THE DATA PROVIDED.
DO NOT GUESS.
DO NOT USE OUTSIDE KNOWLEDGE.

Here is the POLICY SCHEDULE JSON:
${JSON.stringify(scheduleJSON, null, 2)}

Here is the POLICY WORDING TEXT (if available):
${wordingText.slice(0, 20000)}

Here is the COMPARISON RESULT JSON (if available):
${JSON.stringify(comparisonJSON, null, 2)}

User question:
"${message}"

TASKS:
1. Answer the user's question using ONLY information from the JSON or wording text.
2. If the question refers to a section, table, limit, extension, exclusion, deductible, etc — locate it in the JSON.
3. If something is not present in the data, clearly state: "This information is not present in your policy schedule or wording."
4. Keep the answer precise, accurate, non-speculative.
`;

    const final = await openai.responses.create({
      model: "gpt-5-mini",
      input: answerPrompt,
    });

    const answer = final.output_text ?? "I'm sorry, I could not produce an answer.";

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
