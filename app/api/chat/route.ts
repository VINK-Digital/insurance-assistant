import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

type Message = {
  role: "user" | "assistant" | "system";
  content: string;
};

export async function POST(req: Request) {
  try {
    console.log("=== Chat API Called ===");
    
    // Step 1: Parse request body
    const { messages, policyId = 1 } = await req.json();
    console.log("Messages received:", messages?.length);
    console.log("Policy ID:", policyId);
    
    if (!messages || !Array.isArray(messages)) {
      return new Response(
        JSON.stringify({ error: "Missing or invalid messages" }), 
        { status: 400 }
      );
    }

    // Step 2: Check environment variables
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
      console.error("Missing NEXT_PUBLIC_SUPABASE_URL");
      return new Response(
        JSON.stringify({ error: "Supabase URL not configured" }), 
        { status: 500 }
      );
    }
    
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      console.error("Missing SUPABASE_SERVICE_ROLE_KEY");
      return new Response(
        JSON.stringify({ error: "Supabase key not configured" }), 
        { status: 500 }
      );
    }

    if (!process.env.OPENAI_API_KEY) {
      console.error("Missing OPENAI_API_KEY");
      return new Response(
        JSON.stringify({ error: "OpenAI API key not configured" }), 
        { status: 500 }
      );
    }

    console.log("Environment variables OK");

    // Step 3: Connect to Supabase
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
    console.log("Supabase client created");

    // Step 4: Fetch policy from database
    console.log("Fetching policy...");
    const { data: policy, error } = await supabase
      .from("policies")
      .select("tables, text, metadata")
      .eq("id", policyId)
      .single();

    console.log("Policy fetch result:", { 
      found: !!policy, 
      error: error?.message 
    });

    if (error) {
      console.error("Supabase Error:", error);
      return new Response(
        JSON.stringify({ 
          error: `Database error: ${error.message}`,
          details: "Make sure the 'policies' table exists and has data"
        }),
        { status: 500 }
      );
    }
    
    if (!policy) {
      console.error("Policy not found for ID:", policyId);
      return new Response(
        JSON.stringify({ 
          error: `Policy with ID ${policyId} not found`,
          details: "Check if the policy exists in your database"
        }),
        { status: 404 }
      );
    }

    console.log("Policy loaded successfully");

    // Step 5: Initialize OpenAI client
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    console.log("OpenAI client created");

    // Step 6: Build messages array
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
    console.log("Calling OpenAI with", fullMessages.length, "messages");

    // Step 7: Call OpenAI API
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: fullMessages,
    });

    console.log("OpenAI response received");

    const answer = completion.choices[0]?.message?.content || "No response generated.";

    return new Response(JSON.stringify({ answer }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("=== Chat API Error ===");
    console.error("Error name:", err.name);
    console.error("Error message:", err.message);
    console.error("Error stack:", err.stack);
    
    return new Response(
      JSON.stringify({ 
        error: err.message || "Internal server error",
        type: err.name || "Unknown error"
      }), 
      { status: 500 }
    );
  }
}
