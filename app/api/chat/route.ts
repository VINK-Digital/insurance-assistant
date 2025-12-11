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
    // --------------------------------------
    // 0. Parse request body ONCE
    // --------------------------------------
    const body = await req.json();

    const {
      message,
      policies = [],
      customerId,
      lastPolicyId,
      clarification,
    } = body;

    if (!customerId) {
      return NextResponse.json(
        { error: "No customer selected" },
        { status: 400 }
      );
    }

    let selectedPolicyId: string | null = lastPolicyId || null;

    // --------------------------------------
    // 1. Auto-select if only a single policy
    // --------------------------------------
    if (!selectedPolicyId && !clarification && policies.length === 1) {
      selectedPolicyId = policies[0].id;
    }

    // --------------------------------------
    // 2. GPT policy selection for multiples
    // --------------------------------------
    if (!selectedPolicyId && !clarification && policies.length > 1) {
      const choosePrompt = `
A customer asked: "${message}"

Available policies:

${policies
  .map(
    (p: any, i: number) => `
Policy ${i + 1}
UUID="${p.id}"
File="${p.file_name}"
Insurer="${p.insurer}"
Version="${p.wording_version}"
    `
  )
  .join("\n")}

Return ONLY valid JSON:

If clear:
{ "policyId": "<UUID>", "needs_clarification": false }

If unclear:
{ "policyId": null, "needs_clarification": true,
  "clarification_question": "Which policy are you asking about?"
}
`;

      const chooseResp = await openai.responses.create({
        model: "gpt-5-mini",
        input: choosePrompt,
        max_output_tokens: 3000,
      });

      let raw = chooseResp.output_text || "{}";
      raw = raw.replace(/```json/gi, "").replace(/```/g, "").trim();

      let parsed: any;
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

    // --------------------------------------
    // 3. Load policy & wording from Supabase
    // --------------------------------------
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

    // --------------------------------------
    // 4. Build Final Prompt
    // --------------------------------------
    const MAX = 20000;

    const finalPrompt = `
You are VINK — an insurance assistant trained to read two types of documents:

1) POLICY SCHEDULE  
   - This contains limits, deductibles, sub-limits, endorsements, dates.  
   - Treat the schedule as the PRIMARY source for answering coverage questions.  
   - If the schedule lists a limit or deductible, use that exact value.

2) POLICY WORDING  
   - This contains full clause explanations, definitions, exclusions, conditions.  
   - Use wording ONLY to explain what a clause means or how coverage applies.  

RULES FOR ANSWERING:

A) If the user asks: “For how much am I covered for X (e.g., Crime)?”
   • Find the section in the Schedule first (e.g., 2.2(b) Crime).  
   • Answer in this structure:
     1. Direct answer: “You are covered for $X with a $Y deductible.”  
     2. Mention it is a sub-limit if relevant.  
     3. OPTIONAL: Add 1–2 clarifying bullets from the schedule or wording.  
   • DO NOT dump long explanations or irrelevant clauses.

B) If the user asks about a clause number (e.g., “Tell me more about section 2.2(b)”)
   • Go to the wording.  
   • Summarise what the clause does in plain English.  
   • Keep it to 3–5 bullets unless the user explicitly asks for more detail.

C) If the user asks to compare (e.g., “Compare Crime coverage vs Investigation Fees”)
   • Compare sub-limits, deductibles, and purpose.  
   • Keep it structured and concise.

D) If schedule and wording conflict:
   • The SCHEDULE controls limits and deductibles.  
   • The WORDING controls wording interpretation.

E) Keep answers short unless the user asks for deep analysis.

F) When unsure, ask for clarification (e.g., which section or which coverage area).

DATA:

--- SCHEDULE_JSON ---
${JSON.stringify(scheduleJSON).slice(0, MAX)}

--- WORDING_TEXT ---
${
  wordingText
    ? wordingText.slice(0, MAX)
    : "[NO WORDING TEXT AVAILABLE]"
}

--- COMPARISON_JSON ---
${JSON.stringify(comparisonJSON || {}).slice(0, MAX)}

--- USER QUESTION ---
"${message}"

Now produce the best broker-quality answer.
`;

    // --------------------------------------
    // 5. Call OpenAI
    // --------------------------------------
    const aiResp = await openai.responses.create({
      model: "gpt-5-mini",
      input: finalPrompt,
      max_output_tokens: 5000,
    });

    const answer =
      aiResp.output_text ||
      "I could not produce an answer from the available schedule or wording text.";

    // --------------------------------------
    // 6. Respond to frontend
    // --------------------------------------
    return NextResponse.json({
      success: true,
      answer,
      selectedPolicyId,
      debug: {
        schedule_length: JSON.stringify(scheduleJSON).length,
        wording_length: wordingText.length,
        has_wording: wordingText.length > 0,
      },
    });
  } catch (err: any) {
    console.error("CHAT ERROR:", err);
    return NextResponse.json(
      { error: "Chat error", details: err.message },
      { status: 500 }
    );
  }
}
