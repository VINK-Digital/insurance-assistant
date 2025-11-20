import { NextResponse } from "next/server";

const N8N_WEBHOOK_URL =
  "https://n8n.srv1104330.hstgr.cloud/webhook/policy-upload";

export async function POST(req: Request) {
  try {
    // Read incoming file
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json(
        { message: "No file uploaded." },
        { status: 400 }
      );
    }

    // Prepare forward form-data
    const forward = new FormData();
    forward.append("file", file);

    // Send to n8n
    const n8nRes = await fetch(N8N_WEBHOOK_URL, {
      method: "POST",
      body: forward,
    });

    // HTTP-Level failure
    if (!n8nRes.ok) {
      const errorText = await n8nRes.text();
      return NextResponse.json(
        {
          message: "n8n workflow error",
          error: errorText,
        },
        { status: 500 }
      );
    }

    // Attempt to parse JSON safely
    let data: any = null;
    try {
      data = await n8nRes.json();
    } catch {
      return NextResponse.json(
        {
          message: "n8n did not return valid JSON",
        },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        message: data.message || "Upload successful!",
        policyId: data.policyId,
      },
      { status: 200 }
    );
  } catch (err: any) {
    return NextResponse.json(
      {
        message: "Upload failed",
        error: err?.message || String(err),
      },
      { status: 500 }
    );
  }
}
