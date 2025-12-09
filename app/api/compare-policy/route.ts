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

    // 1) Load policy + wording
    const { data: policy } = await supabase
      .from("policies")
      .select("ocr_text, wording_id, file_name, insurer, wording_version")
      .eq("id", policyId)
      .single();

    if (!policy?.ocr_text) {
      return NextResponse.json(
        { error: "Policy has no extracted text" },
        { status: 400 }
      );
    }

    if (!policy?.wording_id) {
      return NextResponse.json(
        { error: "Policy has no matched wording" },
        { status: 400 }
      );
    }

    const { data: wording } = await supabase
      .from("policy_wording")
      .select("wording_text")
      .eq("id", policy.wording_id)
      .single();

    if (!wording?.wording_text) {
      return NextResponse.json(
        { error: "Wording text missing" },
        { status: 400 }
      );
    }

    const scheduleJSON = policy.ocr_text;
    const wordingText = wording.wording_text;

    // 2) Comparison prompt
    const prompt = `
Compare this INSURANCE POLICY SCHEDULE (structured JSON) with this POLICY WORDING (raw text)
and return a STRICT JSON summary:

{
  "sections": [
    {
      "name": "Section name",
      "schedule_limit": "...",
      "wording_limit": "...",
      "match": true/false,
      "notes": "short explanation"
    }
  ],
  "missing_sections": ["..."],
  "endorsement_differences": [
    {
      "endorsement": "...",
      "in_schedule": true/false,
      "in_wording": true/false
    }
  ],
  "overall_risk_summary": "1–2 sentence conclusion with no nonsense."
}

RULES:
- Be precise.
- Use the schedule JSON's tables to read limits.
- If the wording does not specify a limit for a section, set wording_limit=null.
- Do NOT assume limits.
`;

    const completion = await openai.responses.create({
      model: "gpt-5",
      input: [
        { role: "user", content: [
            { type: "input_text", text: prompt },
            { type: "input_text", text: `SCHEDULE_JSON:\n${scheduleJSON}` },
            { type: "input_text", text: `WORDING_TEXT:\n${wordingText}` },
        ]}
      ]
    });

    let output = completion.output_text ?? "{}";

    // Clean up markdown if needed
    output = output
      .replace(/```json/gi, "")
      .replace(/```/g, "")
      .trim();

    const analysis = JSON.parse(output);

    // 3) Save comparison result
    await supabase.from("analysis").insert({
      policy_id: policyId,
      result_json: analysis,
    });

    return NextResponse.json({ success: true, analysis });

  } catch (err: any) {
    return NextResponse.json(
      { error: "Compare error", details: err.message },
      { status: 500 }
    );
  }
}
