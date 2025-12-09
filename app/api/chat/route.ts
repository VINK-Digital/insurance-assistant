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
    const { message, policies = [], lastPolicyId, clarification } =
      await req.json();

    let selectedPolicyId: string | null = lastPolicyId || null;

    // -------------------------------------------------
    // AUTO-SELECT IF ONLY ONE POLICY
    // -------------------------------------------------
    if (!selectedPolicyId && !clarification && policies.length === 1) {
      selectedPolicyId = policies[0].id;
    }

    // -------------------------------------------------
    // GPT POLICY PICKER (only if multiple policies)
    // -------------------------------------------------
    if (!selectedPolicyId && !clarification && policies.length > 1) {
      const choosePrompt = `
A customer asked: "${message}"

Available policies with REAL UUIDs:

${policies
  .map((p: any, i: number) => {
    return `Policy ${i + 1}:
UUID="${p.id}"
File="${p.file_name}"
Insurer="${p.insurer}"
Version="${p.wording_version}"`;
  })
  .join("\n\n")}

Return ONLY JSON:

If clear:
{ "policyId": "<UUID>", "needs_clarification": false }

If unclear:
{ "policyId": null, "needs_clarification": true,
  "clarification_question": "Which policy are you asking about?" }
`;

      const chooseResp = await openai.responses.create({
        model: "gpt-5-mini",
        input: choosePrompt,
        max_output_tokens: 150,
      });

      let raw = chooseResp.output_text || "{}";
      raw = raw.replace(/```json/gi, "").replace(/```/g, "").trim();

      let parsed;

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

    if (!selectedPolicyId) {
      return NextResponse.json(
        { error: "No policy selected" },
        { status: 400 }
      );
    }

    // -------------------------------------------------
    // LOAD POLICY AND WORDING FROM SUPABASE
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
    let comparisonJSON: any = null;

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
    // GPT ANSWER PROMPT (broker-style, concise)
    // -------------------------------------------------
    const MAX = 20000;

    const finalPrompt = `
You are VINK — a specialist insurance assistant for brokers.

DATA YOU HAVE
- POLICY_SCHEDULE_JSON: limits, deductibles, sections, clause references.
- POLICY_WORDING_TEXT: legal clauses, definitions, exclusions.
- COMPARISON_JSON: any pre-calculated differences between schedule and wording.

YOUR JOB
- Answer as a human insurance broker would.
- If the question is about coverage (e.g. "Am I covered for crime?"):
  - Start with a clear yes/no/short statement.
  - Then give 2–5 short bullet points with:
    - key clause numbers (e.g. "Clause 2.2(b) Crime"),
    - limits and deductibles,
    - important conditions or extensions.
- If the question is about a clause (e.g. "tell me about clause 2.2"):
  - Summarise what the clause does in plain English (3–5 sentences max),
  - Mention the clause number and title,
  - Mention relevant limits/deductibles from the schedule.

HOW TO USE THE DATA
- Use the schedule for:
  - limits, sub-limits, deductibles,
  - which sections/clauses are included,
  - automatic extensions and their sub-limits.
- Use the wording text for:
  - what each clause actually means,
  - definitions, exclusions, and conditions.
- If a clause or topic is named in the schedule (e.g. "2.2(b) Crime"),
  you SHOULD answer questions about it using:
  - its title in the schedule,
  - its limit/deductible,
  - any related extensions that mention the same clause/section.
- Only say information is missing if you truly cannot find ANY reference
  to the clause number or topic in EITHER the schedule JSON OR the wording text.

IMPORTANT BEHAVIOUR
- Do NOT say "I could not generate an answer."
- If data is incomplete, say something like:
  "I can see that <topic> is listed in the schedule, but the detailed wording
  is not visible here. Based on the schedule, here is what we can say: ..."
- Do not hallucinate new cover that is not implied by the documents.
- Keep answers concise, broker-friendly, and focused on what the user asked.

---

POLICY_SCHEDULE_JSON:
${JSON.stringify(scheduleJSON).slice(0, MAX)}

---

POLICY_WORDING_TEXT:
${wordingText.slice(0, MAX)}

---

COMPARISON_JSON:
${JSON.stringify(comparisonJSON).slice(0, MAX)}

---

USER QUESTION:
"${message}"

Now provide the best possible broker-style answer based ONLY on the information above.
`;

    const resp = await openai.responses.create({
      model: "gpt-5-mini",
      input: finalPrompt,
      max_output_tokens: 2000,
    });

   return NextResponse.json({
  test: true,
  schedule_length: JSON.stringify(scheduleJSON).length,
  wording_length: wordingText.length,
  first_500_wording_chars: wordingText.slice(0, 500),
  has_writing: wordingText.length > 0,
});

  } catch (err: any) {
    console.error("CHAT ERROR:", err);
    return NextResponse.json(
      { error: "Chat error", details: err.message },
      { status: 500 }
    );
  }
}
