import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

type Message = {
  role: "user" | "assistant" | "system";
  content: string;
};

export async function POST(req: Request) {
  try {
    const { messages, policyId = 1 } = await req.json();
    
    if (!messages || !Array.isArray(messages)) {
      return new Response(
        JSON.stringify({ error: "Missing or invalid messages" }), 
        { status: 400 }
      );
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Fetch policy JSON from Supabase
    const { data: policy, error } = await supabase
      .from("policies")
      .select("tables, text, metadata")
      .eq("id", policyId)
      .single();

    if (error || !policy) {
      console.error("Supabase Error:", error);
      return new Response(
        JSON.stringify({ error: "Could not load policy" }),
        { status: 500 }
      );
    }

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

    // Inject schedule JSON into system prompt
    const systemMessage: Message = {
      role: "system",
      content: `You are an insurance coverage assistant. 
You answer questions ONLY using the following policy schedule data:

${JSON.stringify(policy, null, 2)}

If the user asks for coverage, limits, deductibles, clauses, or extensions, 
give answers directly from the JSON.
If you cannot find something, say: 
"This information is not included in the policy schedule."`
    };

    const fullMessages = [systemMessage, ...messages] as OpenAI.Chat.ChatCompletionMessageParam[];

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: fullMessages,
    });

    const answer = completion.choices[0]?.message?.content || "No response generated.";

    return new Response(JSON.stringify({ answer }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("Chat API Error:", err.message);
    return new Response(
      JSON.stringify({ error: err.message || "Internal server error" }), 
      { status: 500 }
    );
  }
}
