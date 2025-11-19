import { NextResponse } from "next/server";

const N8N_WEBHOOK_URL = "https://n8n.srv1104330.hstgr.cloud/webhook/e5d25543-0222-43ab-bc48-58c42cc01e48";

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json(
        { message: "No file uploaded." },
        { status: 400 }
      );
    }

    // Forward the PDF file to your n8n workflow
    const forward = new FormData();
    forward.append("file", file);

    const n8nResponse = await fetch(N8N_WEBHOOK_URL, {
      method: "POST",
      body: forward,
    });

    if (!n8nResponse.ok) {
      const errorText = await n8nResponse.text();
      return NextResponse.json(
        { message: "n8n workflow failed", error: errorText },
        { status: 500 }
      );
    }

    const data = await n8nResponse.json();

    return NextResponse.json(
      {
        message: data.message || "Upload successful!",
        policyId: data.policyId,
      },
      { status: 200 }
    );
  } catch (err: any) {
    return NextResponse.json(
      { message: "Upload failed", error: err.message },
      { status: 500 }
    );
  }
}
