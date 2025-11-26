import OpenAI from "openai";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { question, policyId } = body;

    if (!question) {
      return new Response(JSON.stringify({ error: "Missing question" }), { status: 400 });
    }

    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY!,
    });

    // TEMP SAFE RESPONSE
    const message = `You asked: ${question}. (API route is working.)`;

    return new Response(JSON.stringify({ answer: message }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  } catch (err: any) {
    console.error("Chat API Error:", err);

    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
