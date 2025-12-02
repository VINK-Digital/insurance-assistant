import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Helper to load full policy context
async function loadPolicyContext(policyId: string) {
  const { data: policy } = await supabase
    .from("policies")
    .select("*")
    .eq("id", policyId)
    .single();

  if (!policy) return null;

  const { data: wording } = await supabase
    .from("policy_wording")
    .select("*")
    .eq("id", policy.wording_id)
    .single();

  const { data: analysis } = await supabase
    .from("policy_analysis")
    .select("*")
    .eq("policy_id", policyId)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  return { policy, wording, analysis };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { message, customerId, policies, lastPolicyId } = body;

    if (!message || !customerId || !policies) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    // We ask GPT to choose the correct policy first.
    const systemMessage = `
You are an expert insurance assistant.

You have multiple policies available for this customer. 
Your job is to:
1. Identify which policy the user's message is referring to.
2. If the user's message could refer to multiple policies, ask for clarification.
3. If the message clearly relates to the policy previously discussed, keep using it.
4. Once a policy is identified, DO NOT hallucinate. Only answer using:
   - The policy schedule OCR text
   - The corresponding policy wording
   - The structured comparison analysis

Return STRICT JSON:
{
  "selected_policy_id": "uuid or null",
  "needs_clarification": true/false,
  "clarification_question": "string or null",
  "final_answer": "string or null"
}
`;

    const policyListString = JSON.stringify(policies, null, 2);

    const choosePolicy = await openai.chat.completions.create({
      model: "gpt-5-mini",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemMessage },
        {
          role: "user",
          content: `
User message:
"${message}"

Customer policies:
${policyListString}

Previously selected policy:
${lastPolicyId ?? "none"}
`
        }
      ]
    });

   const content = choosePolicy.choices[0].message.content;

if (!content) {
  return NextResponse.json(
    { error: "AI returned empty content during policy selection" },
    { status: 500 }
  );
}

const selection = JSON.parse(content);

    // If GPT needs clarifying, return question to frontend
    if (selection.needs_clarification) {
      return NextResponse.json({
        clarification: true,
        question: selection.clarification_question,
      });
    }

    const selectedPolicyId =
      selection.selected_policy_id || lastPolicyId || null;

    if (!selectedPolicyId) {
      return NextResponse.json({
        clarification: true,
        question: "Which policy would you like help with?",
      });
    }

    // Load policy details (OCR + wording + analysis)
    const context = await loadPolicyContext(selectedPolicyId);

    if (!context) {
      return NextResponse.json(
        { error: "Policy context not found" },
        { status: 500 }
      );
    }

    const { policy, wording, analysis } = context;

    // Build second-level GPT answer
    const answerPrompt = `
User question: "${message}"

Policy schedule (OCR):
---
${policy.ocr_text}
---

Policy wording:
---
${wording?.wording_text ?? "No wording text found"}
---

Policy comparison analysis:
---
${analysis?.comparison ? JSON.stringify(analysis.comparison) : "No analysis data available"}
---

Answer the user using only the information above.
If something is not found in the policy, say so honestly.
`;

    const final = await openai.chat.completions.create({
      model: "gpt-5.1",
      messages: [
        { role: "system", content: "You are an insurance expert. Keep responses accurate and concise." },
        { role: "user", content: answerPrompt }
      ]
    });

    const finalAnswer = final.choices[0].message.content;

    return NextResponse.json({
      success: true,
      answer: finalAnswer,
      selectedPolicyId,
    });

  } catch (err: any) {
    console.error(err);
    return NextResponse.json(
      { error: "Server error", details: err.message },
      { status: 500 }
    );
  }
}
