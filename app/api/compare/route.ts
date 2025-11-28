// app/api/compare/route.ts
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
        { error: "Missing policyId in request body" },
        { status: 400 }
      );
    }

    // Fetch policy from Supabase
    const { data: policy, error: policyError } = await supabase
      .from("policies")
      .select("*")
      .eq("id", policyId)
      .single();

    if (policyError || !policy) {
      return NextResponse.json(
        { error: "Policy not found", details: policyError },
        { status: 404 }
      );
    }

    // Fetch matching wording from Supabase
  
    const { data: wording, error: wordingError } = await supabase
      .from("policy_wording")
      .select("*")
      .eq("insurer", policy.insurer)               // assumes policies.insurer exists
      .eq("wording_version", policy.wording_version) // assumes policies.wording_version exists
      .single();

    if (wordingError || !wording) {
      return NextResponse.json(
        {
          error: "Matching wording not found for this policy",
          details: wordingError,
        },
        { status: 404 }
      );
    }

    // 3️Call OpenAI to compare schedule vs wording
    // Assumes wording.wording_text holds the full wording text – adjust if needed.
    const completion = await openai.chat.completions.create({
      model: "gpt-4.1", // or gpt-4.1-mini for cheaper / faster
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are an expert insurance wording analyst. You compare policy schedules with base wordings and return structured JSON.",
        },
        {
          role: "user",
          content: `
Compare the following policy schedule and base wording.

Return STRICT JSON with this structure:

{
  "summary": "short human-readable summary (max 8 lines)",
  "risk_score": 0-100,
  "mismatches": [
    {
      "type": "limit | excess | exclusion | endorsement | condition | activity | other",
      "schedule_value": "string",
      "wording_value": "string",
      "impact": "low | medium | high",
      "comment": "short explanation"
    }
  ],
  "missing_endorsements": [
    {
      "name": "string",
      "reason": "string"
    }
  ],
  "notes": [
    "string",
    "string"
  ]
}

--- POLICY SCHEDULE (from Supabase "policies" row) ---
${JSON.stringify(policy, null, 2)}

--- POLICY WORDING (from Supabase "policy_wording" row) ---
${wording.wording_text ?? ""}
`,
        },
      ],
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) {
      return NextResponse.json(
        { error: "No content returned from OpenAI" },
        { status: 500 }
      );
    }

    // Parse AI JSON and derive summary & risk_score
    let parsed: any;
    try {
      parsed = JSON.parse(content);
    } catch (e) {
      // If model ever returns non-JSON, you can log raw content
      return NextResponse.json(
        { error: "Failed to parse AI JSON", raw: content },
        { status: 500 }
      );
    }

    const summary: string | null = parsed.summary ?? null;
    const riskScore: number | null = parsed.risk_score ?? null;

    // Store in analysis table
    const { data: analysisRow, error: analysisError } = await supabase
      .from("analysis")
      .insert({
        policy_id: policy.id,
        // you can either store the wording.id or null for now
        wording_id: wording.id ?? null,
        analysis_json: parsed,
        summary,
        risk_score: riskScore,
      })
      .select()
      .single();

    if (analysisError) {
      return NextResponse.json(
        {
          error: "Failed to insert analysis into Supabase",
          details: analysisError,
        },
        { status: 500 }
      );
    }

    // Return the analysis to the caller
    return NextResponse.json(
      {
        success: true,
        analysis: analysisRow,
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("Compare route error:", err);
    return NextResponse.json(
      { error: "Unexpected server error", details: String(err?.message ?? err) },
      { status: 500 }
    );
  }
}
