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
    const insurer = formData.get("insurer") as string | null;
    const wordingVersion = formData.get("wordingVersion") as string | null;

    if (!file) {
      return NextResponse.json(
        { error: "Missing file" },
        { status: 400 }
      );
    }

    if (!insurer || !wordingVersion) {
      return NextResponse.json(
        { error: "Missing insurer or wordingVersion" },
        { status: 400 }
      );
    }

    // 1) Upload PDF to Supabase Storage (bucket: "wordings")
    const buffer = Buffer.from(await file.arrayBuffer());
    const ext = file.name.split(".").pop() || "pdf";
    const storagePath = `${randomUUID()}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from("wordings")
      .upload(storagePath, buffer, {
        contentType: file.type || "application/pdf",
      });

    if (uploadError) {
      console.error("Supabase upload error:", uploadError);
      return NextResponse.json(
        { error: "Failed to upload wording file", details: uploadError },
        { status: 500 }
      );
    }

    const base = process.env.SUPABASE_URL!.replace(/\/$/, "");
    const fileUrl = `${base}/storage/v1/object/public/wordings/${storagePath}`;

    // 2) Upload file to OpenAI as an assistant input
    const uploaded = await openai.files.create({
      file,
      purpose: "assistants",
    });

    // 3) Extract full plain text wording
    let wordingText: string;

    try {
      const extraction = await openai.responses.create({
        model: "gpt-5-mini",
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text:
                  "Extract the full readable plain text of this insurance policy wording. " +
                  "Do not summarise, do not explain, do not add markdown. " +
                  "Return only the raw wording text.",
              },
              {
                type: "input_file",
                file_id: uploaded.id,
              },
            ],
          },
        ],
      });

      wordingText = extraction.output_text ?? "";
    } catch (err) {
      console.error("OpenAI wording extraction failed, returning empty text:", err);
      wordingText = "";
    }

    // 4) Insert into policy_wording table
    const { data: wordingRow, error: insertError } = await supabase
      .from("policy_wording")
      .insert({
        insurer,
        wording_version: wordingVersion,
        file_name: file.name,
        file_url: fileUrl,
        wording_text: wordingText,
        status: "uploaded",
      })
      .select()
      .single();

    if (insertError) {
      console.error("Insert policy_wording error:", insertError);
      return NextResponse.json(
        { error: "Failed to insert policy wording", details: insertError },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        wording: wordingRow,
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("Unexpected upload-wording error:", err);
    return NextResponse.json(
      {
        error: "Unexpected server error",
        details: String(err?.message ?? err),
      },
      { status: 500 }
    );
  }
}
