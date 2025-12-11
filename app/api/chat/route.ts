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

    //--------------------------------------
    // 1. Auto-select if only a single policy
    //--------------------------------------
    if (!selectedPolicyId && !clarification && policies.length === 1) {
      selectedPolicyId = policies[0].id;
    }

    //--------------------------------------
    // 2. GPT policy selection for multiples
    //--------------------------------------
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
    const { message, policies, customerId, lastPolicyId } = await req.json();

if (!customerId) {
  return NextResponse.json({ error: "No customer selected" }, { status: 400 });
}

    //--------------------------------------
    // 3. Load policy + wording
    //--------------------------------------
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

    //--------------------------------------
    // 4. Create final system prompt
    //--------------------------------------
    const MAX = 20000;

    const finalPrompt = `
You are VINK — a specialist insurance assistant for brokers.

DATA AVAILABLE
• POLICY_SCHEDULE_JSON — clause names, limits, deductibles  
• POLICY_WORDING_TEXT — clause descriptions, definitions, exclusions  
• COMPARISON_JSON — differences between schedule + wording  

INSTRUCTIONS
• If user asks “Am I covered…?” → Start with a clear answer (“Yes”, “Yes with conditions”, “No”).  
• Then give 2–5 bullet points with:
  - clause number (e.g. 2.2(b) Crime)
  - limit and deductible EXACTLY as shown in schedule
  - relevant conditions or extensions
• If user asks “Tell me about clause X” → Summarise meaning of clause using wording text.
• Only say data is missing if BOTH schedule + wording contain nothing.

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

    //--------------------------------------
    // 5. Ask OpenAI
    //--------------------------------------
    const aiResp = await openai.responses.create({
      model: "gpt-5-mini",
      input: finalPrompt,
      max_output_tokens: 5000,
    });

    const answer =
      aiResp.output_text ||
      "I could not produce an answer from the available schedule or wording text.";

    //--------------------------------------
    // 6. Return to frontend
    //--------------------------------------
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
