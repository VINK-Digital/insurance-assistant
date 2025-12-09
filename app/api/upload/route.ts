 import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const customerId = formData.get("customerId") as string | null;

    // ⭐ NEW: wording selection from UI
    const wordingId = formData.get("wordingId") as string | null;

    if (!file)
      return NextResponse.json({ error: "Missing file" }, { status: 400 });

    if (!customerId)
      return NextResponse.json(
        { error: "Missing customerId" },
        { status: 400 }
      );

    // 1) Upload file to Supabase Storage
    const buffer = Buffer.from(await file.arrayBuffer());
    const fileExt = file.name.split(".").pop() || "pdf";
    const storagePath = `policies/${randomUUID()}.${fileExt}`;

    const { error: uploadError } = await supabase.storage
      .from("policies")
      .upload(storagePath, buffer, {
        contentType: file.type || "application/pdf",
      });

    if (uploadError) {
      return NextResponse.json(
        { error: "Failed to upload file", details: uploadError },
        { status: 500 }
      );
    }

    const base = process.env.SUPABASE_URL!.replace(/\/$/, "");
    const fileUrl = `${base}/storage/v1/object/public/policies/${storagePath}`;

    // 2) Upload file to OpenAI as assistant input
    const uploaded = await openai.files.create({
      file,
      purpose: "assistants",
    });

    // 3) Strict JSON extraction prompt
    const extractionPrompt = `
You extract structured data from Australian insurance policy schedules.

STRICT RULES:
- Return ONLY pure JSON.
- NO markdown.
- NO code fences.
- NO explanations.
- JSON must start with '{' and end with '}'.

Extract with this schema:

{
  "tables": {...},
  "text": "Full extracted readable text or summarised text.",
  "metadata": {...}
}
If fields are missing, set them to null.
`;

    let extractionJson: any | null = null;
    let ocrTextToStore: string | null = null;

    // 4) Primary extraction attempt using GPT-5-mini
    try {
      const result = await openai.responses.create({
        model: "gpt-5-mini",
        input: [
          {
            role: "user",
            content: [
              { type: "input_text", text: extractionPrompt },
              { type: "input_file", file_id: uploaded.id },
            ],
          },
        ],
      });

      let output = result.output_text ?? "";
      output = output.replace(/```json/gi, "").replace(/```/g, "").trim();

      extractionJson = JSON.parse(output);
      ocrTextToStore = JSON.stringify(extractionJson, null, 2);
    } catch (err) {
      console.error("Primary JSON extraction failed, fallback OCR:", err);

      const fb = await openai.responses.create({
        model: "gpt-5-mini",
        input: [
          {
            role: "user",
            content: [
              { type: "input_text", text: "Extract ONLY plain text. No JSON." },
              { type: "input_file", file_id: uploaded.id },
            ],
          },
        ],
      });

      ocrTextToStore = fb.output_text ?? "";
      extractionJson = null;
    }

    // 6) Metadata extraction
    const insurer =
      extractionJson?.metadata?.insurer ??
      extractionJson?.metadata?.issued_by ??
      null;

    const wordingVersion =
      extractionJson?.metadata?.wording_version ??
      extractionJson?.metadata?.wording_reference ??
      null;

    // 7) Insert policy into database ⭐ NOW INCLUDING wordingId
    const { data: policy, error: policyError } = await supabase
      .from("policies")
      .insert({
        customer_id: customerId,
        file_name: file.name,
        file_url: fileUrl,
        ocr_text: ocrTextToStore,
        insurer,
        wording_version: wordingVersion,
        wording_id: wordingId || null, // ⭐ NEW LINE
        status: "uploaded",
      })
      .select()
      .single();

    if (policyError || !policy) {
      return NextResponse.json(
        { error: "Failed to insert policy", details: policyError },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        policy,
        extracted: extractionJson,
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("Unexpected upload error:", err);
    return NextResponse.json(
      { error: "Unexpected server error", details: err.message },
      { status: 500 }
    );
  }
}
