import OpenAI from "openai";

export async function POST(req: Request) {
  try {
    const { messages } = await req.json();

    if (!messages || !Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: "Missing 'messages' array" }), { status: 400 });
    }

    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY!,
    });

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: messages,
    });

    return new Response(JSON.stringify({
      answer: completion.choices[0].message.content
    }), { status: 200 });

  } catch (err: any) {
    console.error("Chat API Error:", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
