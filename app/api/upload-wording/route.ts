import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";

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
    const extractedText = formData.get("extractedText") as string | null;

    if (!file) {
      return NextResponse.json({ error: "Missing file" }, { status: 400 });
    }

    if (!insurer || !wordingVersion) {
      return NextResponse.json(
        { error: "Missing insurer or wordingVersion" },
        { status: 400 }
      );
    }

    if (!extractedText) {
      return NextResponse.json(
        { error: "Missing extracted text" },
        { status: 400 }
      );
    }

    // 1) Upload file to Supabase Storage
    const buffer = Buffer.from(await file.arrayBuffer());
    const ext = file.name.split(".").pop() || "pdf";
    const storagePath = `${randomUUID()}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from("wordings")
      .upload(storagePath, buffer, {
        contentType: file.type || "application/pdf",
      });

    if (uploadError) {
      return NextResponse.json(
        { error: "Failed to upload wording file", details: uploadError },
        { status: 500 }
      );
    }

    const base = process.env.SUPABASE_URL!.replace(/\/$/, "");
    const fileUrl = `${base}/storage/v1/object/public/wordings/${storagePath}`;

    // 2) Save wording text + metadata to DB
    const { data: wordingRow, error: insertError } = await supabase
      .from("policy_wording")
      .insert({
        insurer,
        wording_version: wordingVersion,
        file_name: file.name,
        file_url: fileUrl,
        wording_text: extractedText,
        status: "uploaded",
      })
      .select()
      .single();

    if (insertError) {
      return NextResponse.json(
        { error: "Failed to insert wording", details: insertError },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, wording: wordingRow });
  } catch (err: any) {
    return NextResponse.json(
      { error: "Unexpected server error", details: err.message },
      { status: 500 }
    );
  }
}
