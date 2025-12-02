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

    // 1. Load policy (must already be matched to a wording)
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

    if (!policy.ocr_text) {
      return NextResponse.json(
        { error: "Policy has no ocr_text to compare" },
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

    if (!wording.wording_text) {
      return NextResponse.json(
        { error: "Wording has no wording_text to compare" },
        { status: 400 }
      );
    }

    // 3. Run comparison via Chat Completions (same style as extract route)
    const completion = await openai.chat.completions.create({
      model: "gpt-5.1-mini",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are an assistant that compares Australian insurance policy schedules to their official policy wordings. Return STRICT JSON only.",
        },
        {
          role: "user",
          content: `
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
      "severity": "low" | "medium" | "high"
    }
  ],
  "missing_clauses": [
    {
      "clause": "string",
      "description": "string",
      "impact": "string"
    }
  ],
  "notable_exclusions": [
    {
      "exclusion": "string",
      "where_found": "string",
      "impact": "string"
    }
  ],
  "recommendations": [
    {
      "item": "string",
      "priority": "low" | "medium" | "high"
    }
  ]
}

Policy Schedule Text:
---
${policy.ocr_text}
---

Official Policy Wording Text:
---
${wording.wording_text}
---
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

    let analysis: any;
    try {
      analysis = JSON.parse(content);
    } catch (e) {
      return NextResponse.json(
        { error: "Failed to parse AI JSON", raw: content },
        { status: 500 }
      );
    }

    // 4. Save analysis into policy_analysis table
    const { data: saved, error: saveError } = await supabase
      .from("policy_analysis")
      .insert({
        policy_id: policy.id,
        wording_id: wording.id,
        comparison: analysis,
        summary: analysis.overall_summary ?? null,
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
      { error: "Unexpected error", details: String(err?.message ?? err) },
      { status: 500 }
    );
  }
}
