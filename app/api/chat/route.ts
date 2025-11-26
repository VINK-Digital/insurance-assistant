import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function askPolicyQuestion(policyId: string, question: string) {
  const policy = await getPolicy(policyId);

  const systemPrompt = `
You are an insurance policy analysis assistant.
You answer questions about an insurance policy based on the structured JSON provided.
Always ground your answers **strictly** in the JSON content.
If the user asks something not in the JSON, say "This information is not provided in the policy schedule."

Here is the policy schedule JSON:
${JSON.stringify(policy, null, 2)}
  `;

  const response = await client.chat.completions.create({
    model: "gpt-4o-mini", 
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: question }
    ]
  });

  return response.choices[0].message.content;
}
