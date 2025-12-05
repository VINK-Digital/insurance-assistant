export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

// USE PUBLIC KEY ENV HERE
const openai = new OpenAI({
  apiKey: process.env.NEXT_PUBLIC_OPENAI_API_KEY!,
});

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: NextRequest) {
  try {
    const {
      message,
      customerId,
      policies = [],
      lastPolicyId,
      clarification,
    } = await req.json();

    let selectedPolicyId: string | null = lastPolicyId || null;

    // -------------------------------------------------
    // 0. If there's only ONE policy, just use it
    // -------------------------------------------------
    if (!selectedPolicyId && !clarification && policies.length === 1) {
      selectedPolicyId = policies[0].id;
      console.log("Only one policy, auto-selected:", selectedPolicyId);
    }

    // -------------------------------------------------
    // 1. POLICY SELECTION USING GPT (only if needed)
    // -------------------------------------------------
    if (!selectedPolicyId && !clarification && policies.length > 1) {
      const choosePrompt = `
A customer asked: "${message}"

Here are the available policies (each includes its TRUE UUID):

${policies
  .map(
    (p: any, i: number) =>
      `Policy ${i + 1}:
UUID="${p.id}"
File="${p.file_name}"
Insurer="${p.insurer}"
Version="${p.wording_version}"`
  )
  .join("\n\n")}

RULES:
- ALWAYS return the exact UUID field shown above.
- NEVER return the index number (1, 2, etc.).
- NEVER return "#1", "Policy 1", or anything except the UUID string.

Return ONLY one JSON object:

If clear:
{ "policyId": "<UUID>", "needs_clarification": false }

If unclear:
{ "policyId": null, "needs_clarification": true,
  "clarification_question": "Which policy are you asking about?" }
`;

      const chooseResp = await openai.responses.create({
        model: "gpt-5-mini",
        input: choosePrompt,
        max_output_tokens: 100,
      });

      let raw = chooseResp.output_text || "{}";
      raw = raw.replace(/```json/gi, "").replace(/```/g, "").trim();

      let parsed: any = {};

      try {
        parsed = JSON.parse(raw);
      } catch {
        return NextResponse.json({
          clarification: true,
          question: "Which policy are you asking about?",
        });
      }

      if (parsed.needs_clarifi_
