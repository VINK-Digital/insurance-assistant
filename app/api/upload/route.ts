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

    if (!file) {
      return NextResponse.json(
        { error: "Missing file in form-data" },
        { status: 400 }
      );
    }

    if (!customerId) {
      return NextResponse.json(
        { error: "Missing customerId in form-data" },
        { status: 400 }
      );
    }

    // 1) Upload file to Supabase Storage
    const fileBytes = await file.arrayBuffer();
    const fileBuffer = Buffer.from(fileBytes);

    const fileExt = file.name.split(".").pop();
    const filePath = `policies/${randomUUID()}.${fileExt || "pdf"}`;

    const { data: storageData, error: storageError } = await supabase.storage
      .from("policies") // bucket name
      .upload(filePath, fileBuffer, {
        contentType: file.type || "application/pdf",
      });

    if (storageError) {
      return NextResponse.json(
        { error: "Failed to upload to storage", details: storageError },
        { status: 500 }
      );
    }

    const baseUrl = process.env.SUPABASE_URL!.replace(/\/$/, "");
    const fileUrl = `${baseUrl}/storage/v1/object/public/policies/${filePath}`;

    // 2) Upload file to OpenAI for vision/extraction
    const uploaded = await openai.files.create({
      file,
      purpose: "assistants",
    });

    // 3) Ask gpt-4o for FULL structured JSON extraction
    const extractionPrompt = `
You are an expert in parsing Australian insurance policy schedules.

Read the attached PDF and return ONLY VALID JSON (no prose, no explanation) in this structure:

{
  "tables": { 
    "Table Name": [
      ["Header 1", "Header 2"],
      ["Row1Col1", "Row1Col2"]
    ]
  },
  "text": "Full plain-language text or narrative summary of the policy schedule.",
  "metadata": {
    "insurer": "Name of insurer if present, else null",
    "policy_number": "Policy number if present, else null",
    "policy_type": "e.g. 'Association Liability', 'Hangarkeepers Liability'",
    "wording_version": "Wording reference or version e.g. '11.20', 'V11.2', else null",
    "effective_date": "Start date if present",
    "expiry_date": "End date if present",
    "currency": "Policy currency if present",
    "coverage_limit": "Top-level limit if clearly defined, else null"
  }
}

VERY IMPORTANT:
- If different sections (e.g. Section 1/2/3) have different limits, do NOT assume a single coverage_limit applies to all.
- Preserve distinct sections inside "tables" or clearly explain in "text".
- If information is missing, set fields to null instead of guessing.
`;

    let extractionJson: any | null = null;
    let ocrTextToStore: string | null = null;

    try {
      const extraction = (await openai.responses.create({
        model: "gpt-4o",
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: extractionPrompt,
              },
              {
                type: "input_file",
                file_id: uploaded.id,
              },
            ],
          },
        ],
      })) as any;

      const outputText: string =
        extraction.output?.[0]?.content?.[0]?.text?.value ??
        extraction.output?.[0]?.content?.[0]?.text ??
        extraction.output_text ??
        "";

      extractionJson = JSON.parse(outputText);
      ocrTextToStore = JSON.stringify(extractionJson, null, 2);
    } catch (err) {
      // 4) Fallback: simple OCR text only
      console.error("Primary JSON extraction failed, falling back to plain text:", err);

      const fallbackPrompt = `
You are doing fallback OCR.

Read the attached PDF and return ONLY the full extracted text as a plain string.
No JSON, no extra commentary.
`;

      const fallback = (await openai.responses.create({
        model: "gpt-4o",
        input: [
          {
            role: "user",
            content: [
              { type: "input_text", text: fallbackPrompt },
              { type: "input_file", file_id: uploaded.id },
            ],
          },
        ],
      })) as any;

      const fbText: string =
        fallback.output?.[0]?.content?.[0]?.text?.value ??
        fallback.output?.[0]?.content?.[0]?.text ??
        fallback.output_text ??
        "";

      extractionJson = null;
      ocrTextToStore = fbText;
    }

    // 5) Pull basic metadata if available
    const insurer =
      extractionJson?.metadata?.insurer ??
      extractionJson?.metadata?.issued_by ??
      null;

    const wordingVersion =
      extractionJson?.metadata?.wording_version ??
      extractionJson?.metadata?.wording_reference ??
      null;

    // 6) Insert into policies table
    const { data: policy, error: policyError } = await supabase
      .from("policies")
      .insert({
        customer_id: customerId,
        file_name: file.name,
        file_url: fileUrl,
        ocr_text: ocrTextToStore,
        insurer: insurer,
        wording_version: wordingVersion,
        status: "uploaded", // will be updated by extract & match
      })
      .select()
      .single();

    if (policyError || !policy) {
      return NextResponse.json(
        { error: "Failed to insert policy", details: policyError },
        { status: 500 }
      );
    }

    // 7) Auto-run extract-policy and match-policy on this new policy
    const reqUrl = new URL(req.url);
    const origin = `${reqUrl.protocol}//${reqUrl.host}`;

    // fire-and-forget style, but we await so you get errors in logs
    try {
      await fetch(`${origin}/api/extract-policy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ policyId: policy.id }),
      });
    } catch (e) {
      console.error("Error calling /api/extract-policy:", e);
    }

    try {
      await fetch(`${origin}/api/match-policy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ policyId: policy.id }),
      });
    } catch (e) {
      console.error("Error calling /api/match-policy:", e);
    }

    return NextResponse.json(
      {
        success: true,
        policy,
        extraction: extractionJson,
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("Unexpected /api/upload error:", err);
    return NextResponse.json(
      { error: "Unexpected server error", details: String(err?.message ?? err) },
      { status: 500 }
    );
  }
}
