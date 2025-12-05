import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();

    const file = formData.get("file") as File | null;
    const insurer = formData.get("insurer") as string | null;
    const wordingVersion = formData.get("wordingVersion") as string | null;

    if (!file) {
      return NextResponse.json({ error: "Missing file" }, { status: 400 });
    }
    if (!insurer || !wordingVersion) {
      return NextResponse.json(
        { error: "Missing insurer or version" },
        { status: 400 }
      );
    }

    // → Forward to n8n webhook
    const forwardForm = new FormData();
    forwardForm.append("file", file);
    forwardForm.append("insurer", insurer);
    forwardForm.append("wordingVersion", wordingVersion);

    const n8nRes = await fetch(
      "https://n8n.srv1104330.hstgr.cloud/webhook/policy-wording",
      {
        method: "POST",
        body: forwardForm,
      }
    );

    if (!n8nRes.ok) {
      const text = await n8nRes.text();
      return NextResponse.json(
        { error: "n8n webhook failed", details: text },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: "Unexpected server error", details: err.message },
      { status: 500 }
    );
  }
}
