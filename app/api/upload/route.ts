import { NextResponse } from "next/server";

const N8N_WEBHOOK_URL = "https://n8n.srv1104330.hstgr.cloud/webhook/policy-upload";

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    // THIS is the missing piece → extract real PDF bytes
    const arrayBuffer = await file.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);

    // Forward REAL binary pdf to n8n
    const upload = new FormData();
    upload.append(
    "file0",
    new Blob([bytes], { type: file.type }),
    file.name
    );

    const res = await fetch(N8N_WEBHOOK_URL, {
      method: "POST",
      body: upload,
    });

    const text = await res.text();

    return NextResponse.json({ success: true, n8n: text });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
