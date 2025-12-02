import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

export async function POST(req: NextRequest) {
  try {
    const { policyId } = await req.json();

    if (!policyId) {
      return NextResponse.json(
        { error: "Missing policyId" },
        { status: 400 }
      );
    }

    // 1. Load policy with wording_id
    const { data: policy, error: policyError } = await supabase
      .from("policies")
      .select("id, insurer, wording_id, ocr_text")
      .eq("id", policyId)
      .single();

    if (!policy || policyError) {
      return NextResponse.json(
        { error: "Policy not found", details: policyError },
        { status: 404 }
      );
    }

    if (!policy.wording_id) {
      return NextResponse.json(
        { error: "Policy has no wording_id — run match first" },
        { status: 400 }
      );
    }

    // 2. Load wording text
    const { data: wording, error: wordingError } = await supabase
      .from("policy_wording")
      .select("id, wording_text")
      .eq("id", policy.wording_id)
      .single();

    if (!wording || wordingError) {
      return NextResponse.json(
        { error: "Wording not found", details: wordingError },
        { status: 404 }
      );
    }

    // 3. Run comparison via GPT
    const prompt = `
Compare the following Australian insurance policy schedule to the official policy wording.

Return STRICT JSON ONLY in this structure:
{
  "overall_summary": "string",
  "differences": [
    {
      "clause": "string",
      "policy_position": "string",
      "wording_position": "string",
      "difference_summary": "string",
      "severity": "low | medium | high"
    }
  ],
  "missing_clauses": [...],
  "notable_exclusions": [...],
  "recommendations": [...]
}

Policy Schedule Text:
---
${policy.ocr_text}
---

Official Policy Wording Text:
---
${wording.wording_text}
---
    `;

    const completion = await openai.responses.create({
      model: "gpt-4.1",
      input: prompt,
      response_format: { type: "json_object" }
    });

    const analysis = JSON.parse(completion.output_text);

    // 4. Save analysis to DB
    const { data: saved, error: saveError } = await supabase
      .from("policy_analysis")
      .insert({
        policy_id: policy.id,
        wording_id: wording.id,
        comparison: analysis,
        summary: analysis.overall_summary
      })
      .select()
      .single();

    if (saveError) {
      return NextResponse.json(
        { error: "Failed to save analysis", details: saveError },
        { status: 500 }
      );
    }

    // 5. Update policy status
    await supabase
      .from("policies")
      .update({ status: "compared" })
      .eq("id", policy.id);

    return NextResponse.json(
      { success: true, analysis: saved },
      { status: 200 }
    );

  } catch (err: any) {
    return NextResponse.json(
      { error: "Unexpected error", details: String(err) },
      { status: 500 }
    );
  }
}
