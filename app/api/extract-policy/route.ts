import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

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

    // 1) Get policy with ocr_text
    const { data: policy, error: policyError } = await supabase
      .from("policies") // change if your table is named differently
      .select("id, ocr_text")
      .eq("id", policyId)
      .single();

    if (policyError || !policy) {
      return NextResponse.json(
        { error: "Policy not found", details: policyError },
        { status: 404 }
      );
    }

    if (!policy.ocr_text) {
      return NextResponse.json(
        { error: "Policy has no ocr_text to extract from" },
        { status: 400 }
      );
    }

    // 2) Ask OpenAI to extract insurer + wording_version
    const completion = await openai.chat.completions.create({
      model: "gpt-5.1-mini",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You extract structured data from Australian insurance policy schedules. Return strict JSON.",
        },
        {
          role: "user",
          content: `
From the following policy schedule text, extract:

- insurer: name of the insurer entity (e.g. "DUAL", "DUAL Australia Pty Limited")
- wording_version: the policy wording version or reference (e.g. "11.20", "V11.2", etc.)

Return ONLY JSON in this shape:

{
  "insurer": "string",
  "wording_version": "string"
}

Policy schedule text:
---
${policy.ocr_text}
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

    let parsed: any;
    try {
      parsed = JSON.parse(content);
    } catch (e) {
      return NextResponse.json(
        { error: "Failed to parse AI JSON", raw: content },
        { status: 500 }
      );
    }

    const insurer = parsed.insurer?.trim() || null;
    const wordingVersion = parsed.wording_version?.trim() || null;

    if (!insurer || !wordingVersion) {
      return NextResponse.json(
        { error: "AI did not return insurer and wording_version", parsed },
        { status: 400 }
      );
    }

    // 3) Update policy with extracted fields
    const { data: updated, error: updateError } = await supabase
      .from("policies")
      .update({
        insurer,
        wording_version: wordingVersion,
        status: "extracted",
      })
      .eq("id", policy.id)
      .select()
      .single();

    if (updateError) {
      return NextResponse.json(
        { error: "Failed to update policy with extracted data", details: updateError },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { success: true, policy: updated, extracted: parsed },
      { status: 200 }
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: "Unexpected server error", details: String(err?.message ?? err) },
      { status: 500 }
    );
  }
}
