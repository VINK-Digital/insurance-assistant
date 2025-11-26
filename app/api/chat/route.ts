import OpenAI from "openai";

export async function POST(req: Request) {
  try {
    let bodyText = await req.text();
    console.log("RAW BODY:", bodyText);

    // Try parse JSON
    let body;
    try {
      body = JSON.parse(bodyText);
    } catch (e) {
      return new Response(JSON.stringify({
        error: "Invalid JSON body",
        raw: bodyText
      }), { status: 400 });
    }

    const { question, policyId } = body;

    if (!question) {
      return new Response(JSON.stringify({
        error: "Missing 'question' field",
        received: body
      }), { status: 400 });
    }

    return new Response(JSON.stringify({
      answer: `OK: I received your question: ${question}`
    }), { status: 200 });

  } catch (err: any) {
    console.error("Chat API Error:", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
