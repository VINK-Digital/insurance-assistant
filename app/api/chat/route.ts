import { NextResponse } from "next/server";
import OpenAI from "openai";

export const runtime = "edge"; // Important for Vercel

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

export async function POST(req: Request) {
  try {
    const { messages } = await req.json();

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are an insurance assistant." },
        ...messages
      ],
    });

    return NextResponse.json({
      answer: completion.choices[0].message.content,
    });
  } catch (err: any) {
    console.error("API error:", err);
    return NextResponse.json(
      { answer: "Server error occurred." },
      { status: 500 }
    );
  }
}
