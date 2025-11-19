import { NextResponse } from "next/server";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

export async function POST(req: Request) {
  try {
    const { messages } = await req.json();

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are an insurance assistant." },
        ...messages,
      ],
    });

    const answer = completion.choices[0].message.content;

    return NextResponse.json({ answer });
  } catch (e) {
    console.error("Chat error:", e);
    return NextResponse.json({ answer: "Error processing your request." });
  }
}

