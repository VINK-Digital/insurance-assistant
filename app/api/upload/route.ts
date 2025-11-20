import { NextResponse } from "next/server";

const N8N_WEBHOOK_URL = "https://n8n.srv1104330.hstgr.cloud/webhook/policy-upload";

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("file") as File;

    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    // READ THE ACTUAL BYTES — THIS IS THE IMPORTANT PART
    const arrayBuffer = await file.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);

    // FORWARD REAL BINARY TO N8N
    const upload = new FormData();
    upload.append("file", new Blob([bytes], { type: file.type }), file.name);

    const n8nRes = await fetch(N8N_WEBHOOK_URL, {
      method: "POST",
      body: upload,
    });

    const data = await n8nRes.text();

    return NextResponse.json({ message: "Uploaded", n8n: data });

  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Upload failed" },
      { status: 500 }
    );
  }
}
