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
      policies = [],
      lastPolicyId,
      clarification,
    } = await req.json();

    let selectedPolicyId: string | null = lastPolicyId || null;

    // -------------------------------------------------
    // 1. AUTO-SELECT IF ONLY ONE POLICY
    // -------------------------------------------------
    if (!selectedPolicyId && !clarification && policies.length === 1) {
      selectedPolicyId = policies[0].id;
      console.log("CHAT: auto-selected single policy:", selectedPolicyId);
    }

    // -------------------------------------------------
    // 2. GPT POLICY PICKER (only if multiple policies)
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

Return ONLY JSON.

If clear:
{ "policyId": "<UUID>", "needs_clarification": false }

If unclear:
{ "policyId": null, "needs_clarification": true,
  "clarification_question": "Which policy are you asking about?" }
`;

      const chooseResp = await openai.responses.create({
        model: "gpt-5-mini",
        input: choosePrompt, // simple string input
        max_output_tokens: 150,
      });

      let raw = chooseResp.output_text || "{}";
      raw = raw.replace(/```json/gi, "").replace(/```/g, "").trim();

      let parsed: any;
      try {
        parsed = JSON.parse(raw);
      } catch (e) {
        console.error("CHAT: failed to parse policy picker JSON:", raw);
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
      console.log("CHAT: GPT-selected policy:", selectedPolicyId);
    }

    if (!selectedPolicyId) {
      return NextResponse.json(
        { error: "No policy selected" },
        { status: 400 }
      );
    }

    // -------------------------------------------------
    // 3. LOAD POLICY + WORDING FROM SUPABASE
    // -------------------------------------------------
    const { data: policy, error: policyErr } = await supabase
      .from("policies")
      .select("ocr_text, wording_id, file_name, insurer, wording_version")
      .eq("id", selectedPolicyId)
      .single();

    if (policyErr || !policy) {
      console.error("CHAT: policy not found or error:", policyErr);
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
      const { data: wording, error: wordingErr } = await supabase
        .from("policy_wording")
        .select("wording_text")
        .eq("id", policy.wording_id)
        .single();

      if (wordingErr) {
        console.error("CHAT: wording load error:", wordingErr);
      }

      wordingText = wording?.wording_text || "";

      const { data: comp, error: compErr } = await supabase
        .from("analysis")
        .select("result_json")
        .eq("policy_id", selectedPolicyId)
        .order("id", { ascending: false })
        .limit(1)
        .single();

      if (compErr) {
        console.error("CHAT: comparison load error:", compErr);
      }

      comparisonJSON = comp?.result_json || null;
    } else {
      console.warn(
        "CHAT: policy has no wording_id, only schedule will be used.",
        selectedPolicyId
      );
    }

    // Log lengths so you can see if wording is actually there
    const scheduleLen = JSON.stringify(scheduleJSON).length;
    const wordingLen = wordingText.length;
    const comparisonLen = JSON.stringify(comparisonJSON || {}).length;
    console.log("CHAT: lengths", {
      scheduleLen,
      wordingLen,
      comparisonLen,
      hasWording: wordingLen > 0,
    });

    // -------------------------------------------------
    // 4. BUILD PROMPT (STRING INPUT)
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
  - Start with a clear coverage statement ("Yes, but…", "Partially", "No…").
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

NUMBERS / LIMITS
- When giving limits or deductibles, COPY the value exactly as shown in the schedule.
- Do NOT simplify or shorten numbers ("$5,000" must NOT become "$5" or "$5k").
- If uncertain, quote the value verbatim from the schedule.

IF WORDING IS MISSING
- If wording text is empty, rely only on the schedule.
- In that case, say: "I only have the schedule, not the full wording text; based on the schedule: ..."
- Still answer with what you can see.

STYLE
- Keep answers concise, broker-friendly, and focused on what the user asked.
- Prefer bullet points for coverage questions.

---

POLICY_SCHEDULE_JSON:
${JSON.stringify(scheduleJSON).slice(0, MAX)}

---

POLICY_WORDING_TEXT:
${
  wordingText
    ? wordingText.slice(0, MAX)
    : "[NO WORDING TEXT AVAILABLE IN DATABASE]"
}

---

COMPARISON_JSON:
${JSON.stringify(comparisonJSON || {}).slice(0, MAX)}

---

USER QUESTION:
"${message}"

Now provide the best possible broker-style answer based ONLY on the information above.
`;

    // -------------------------------------------------
    // 5. CALL OPENAI
    // -------------------------------------------------
    const resp = await openai.responses.create({
      model: "gpt-5-mini",
      input: finalPrompt,
      max_output_tokens: 800,
    });

    const answer =
      resp.output_text ||
      "I couldn't find enough detail in the schedule or wording text provided to answer that confidently.";

    // -------------------------------------------------
    // 6. RETURN ANSWER TO FRONTEND
    // -------------------------------------------------
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
