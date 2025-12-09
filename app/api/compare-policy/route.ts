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
    const { policyId } = await req.json();
    if (!policyId) {
      return NextResponse.json(
        { error: "Missing policyId" },
        { status: 400 }
      );
    }

    // ------------------------------
    // 1) LOAD POLICY + WORDING
    // ------------------------------
    const { data: policy, error: policyErr } = await supabase
      .from("policies")
      .select("ocr_text, wording_id, file_name, insurer, wording_version")
      .eq("id", policyId)
      .single();

    if (policyErr || !policy?.ocr_text) {
      return NextResponse.json(
        { error: "Policy has no extracted text" },
        { status: 400 }
      );
    }

    if (!policy.wording_id) {
      return NextResponse.json(
        { error: "Policy has no matched wording" },
        { status: 400 }
      );
    }

    const { data: wording, error: wordingErr } = await supabase
      .from("policy_wording")
      .select("wording_text")
      .eq("id", policy.wording_id)
      .single();

    if (wordingErr || !wording?.wording_text) {
      return NextResponse.json(
        { error: "Wording text missing" },
        { status: 400 }
      );
    }

    const scheduleJSON = policy.ocr_text;
    const wordingText = wording.wording_text;

    const scheduleLen = JSON.stringify(scheduleJSON).length;
    const wordingLen = wordingText.length;

    console.log("COMPARE: lengths →", {
      scheduleLen,
      wordingLen,
      hasWording: wordingLen > 0,
    });

    // ------------------------------
    // 2) Build ONE large string prompt
    // ------------------------------
    const MAX = 20000; // keeps model reliable, avoids huge context crashes

    const prompt = `
You are a senior insurance analyst. Compare an INSURANCE POLICY SCHEDULE (structured JSON)
with the POLICY WORDING (full legal text).

You MUST return STRICT JSON in this exact schema:

{
  "sections": [
    {
      "name": "string",
      "schedule_limit": "string or null",
      "wording_limit": "string or null",
      "match": true/false,
      "notes": "short plain-English explanation"
    }
  ],
  "missing_sections": ["string"],
  "endorsement_differences": [
    {
      "endorsement": "string",
      "in_schedule": true/false,
      "in_wording": true/false
    }
  ],
  "overall_risk_summary": "1–2 sentences."
}

RULES:
- Use the schedule JSON to extract LIMITS, DEDUCTIBLES, SUBLIMITS.
- Use the wording text to determine what is actually covered or excluded.
- NEVER invent limits. If wording has no limit, set "wording_limit": null.
- NEVER output explanations outside the JSON.
- NEVER modify or simplify numbers. Copy schedule values exactly.
- Be strict, precise, and concise.

---------------- SCHEDULE_JSON ----------------
${JSON.stringify(scheduleJSON).slice(0, MAX)}

---------------- WORDING_TEXT ----------------
${wordingText.slice(0, MAX)}

NOW RETURN ONLY THE JSON.`;

    // ------------------------------
    // 3) Call OpenAI using correct v6 syntax
    // ------------------------------
    const ai = await openai.responses.create({
      model: "gpt-5", // correct for comparison task
      input: prompt,
      max_output_tokens: 2000,
    });

    let raw = ai.output_text ?? "{}";

    raw = raw.replace(/```json/gi, "").replace(/```/g, "").trim();

    let analysis;
    try {
      analysis = JSON.parse(raw);
    } catch (err) {
      console.error("COMPARE: JSON parse error:", raw);
      return NextResponse.json(
        { error: "AI returned invalid JSON", raw },
        { status: 500 }
      );
    }

    // ------------------------------
    // 4) Save comparison to DB
    // ------------------------------
    await supabase.from("analysis").insert({
      policy_id: policyId,
      result_json: analysis,
    });

    return NextResponse.json({ success: true, analysis });

  } catch (err: any) {
    console.error("COMPARE ERROR:", err);
    return NextResponse.json(
      { error: "Compare error", details: err.message },
      { status: 500 }
    );
  }
}
