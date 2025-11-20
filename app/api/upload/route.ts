import { NextResponse } from "next/server";

const N8N_WEBHOOK_URL =
  "https://n8n.srv1104330.hstgr.cloud/webhook/policy-upload";

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        {
          ok: false,
          step: "no-file",
          message: "No file found in formData under key 'file'",
        },
        { status: 400 }
      );
    }

    const forward = new FormData();
    forward.append("file", file);

    let n8nResponse: Response;
    try {
      n8nResponse = await fetch(N8N_WEBHOOK_URL, {
        method: "POST",
        body: forward,
      });
    } catch (error) {
      return NextResponse.json(
        {
          ok: false,
          step: "fetch-failed",
          message: "Could not reach n8n webhook",
          error: String(error),
        },
        { status: 502 }
      );
    }

    const rawText = await n8nResponse.text();

    if (!n8nResponse.ok) {
      return NextResponse.json(
        {
          ok: false,
          step: "n8n-not-ok",
          status: n8nResponse.status,
          body: rawText,
        },
        { status: 500 }
      );
    }

    let json: any = null;
    try {
      json = JSON.parse(rawText);
    } catch {
      // n8n didn't return JSON
    }

    return NextResponse.json(
      {
        ok: true,
        step: "done",
        n8nStatus: n8nResponse.status,
        n8nRaw: rawText,
        n8nJson: json,
      },
      { status: 200 }
    );
  } catch (err: any) {
    return NextResponse.json(
      {
        ok: false,
        step: "route-error",
        message: err.message,
      },
      { status: 500 }
    );
  }
}
