import OpenAI from "openai";

export async function POST(req: Request) {
  const { policyId, question } = await req.json();

  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY!,
  });

  // fetch policy from Supabase here
  // const policy = ...

  const systemPrompt = `
You are an Insurance Policy Analysis AI.
You answer questions based ONLY on the provided policy schedule and metadata.

Rules:
- Always look inside 'tables', 'text', and 'metadata'.
- If a value appears multiple times, prefer table data over free text.
- Use exact numbers and wording from the JSON.
- If the policy does NOT include a coverage, say so clearly.
- If the user asks something outside the schedule, say:
  "This information is not included in the policy schedule."

Return clear, concise answers.
  `;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: question }
    ]
  });

  return new Response(
    JSON.stringify({ answer: completion.choices[0].message.content }),
    { status: 200 }
  );
}
