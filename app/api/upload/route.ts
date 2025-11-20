import { NextResponse } from "next/server";

const N8N_WEBHOOK_URL =
  "https://n8n.srv1104330.hstgr.cloud/webhook/policy-upload";

export async function POST(req: Request) {
  try {
    // Read the incoming PDF file from the frontend
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json(
        { message: "No file uploaded." },
        { status: 400 }
      );
    }

    // Prepare the form-data to forward to n8n
    const forward = new FormData();
    forward.append("file", file);

    // Forward the PDF to your n8n ingestion workflow
    const n8nRes = await fetch(N8N_WEBHOOK_URL, {
      method: "POST",
      body: forward,
    });

    // If n8n fails at HTTP level (400/500)
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

    // Try to parse the JSON response from n8n
    const data = await n8nRes.json().catch(() => null);
