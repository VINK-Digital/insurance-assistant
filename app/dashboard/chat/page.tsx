"use client";
import { useState } from "react";

type Message = {
  role: "user" | "assistant";
  content: string;
};

export default function Page() {
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", content: "Hi! I'm your Insurance AI assistant. How can I help?" }
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [policyId, setPolicyId] = useState<string>(""); // User needs to set this

  async function sendMessage() {
    if (!input.trim() || loading) return;

    if (!policyId) {
      setMessages([...messages, { 
        role: "assistant", 
        content: "Please enter a Policy ID first." 
      }]);
      return;
    }

    const newMessage: Message = { role: "user", content: input };
    const updatedMessages = [...messages, newMessage];
    setMessages(updatedMessages);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          messages: updatedMessages,
          policyId: policyId 
        }),
      });

      if (!res.ok) {
        throw new Error(`API error: ${res.status}`);
      }

      const data = await res.json();
      
      if (data.error) {
        throw new Error(data.error);
      }

      setMessages([
        ...updatedMessages, 
        { role: "assistant", content: data.answer || "No response received." }
      ]);
    } catch (error: any) {
      console.error("Chat error:", error);
      setMessages([
        ...updatedMessages, 
        { 
          role: "assistant", 
          content: `Error: ${error.message || "Failed to get response. Please try again."}` 
        }
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto p-6 h-screen flex flex-col">
      <h1 className="text-2xl font-bold mb-4">Insurance AI Demo</h1>
      
      {/* Policy ID Input */}
      <div className="mb-4">
        <label className="block text-sm font-medium mb-2">
          Policy ID (UUID from your database):
        </label>
        <input
          className="w-full border p-2 rounded"
          value={policyId}
          placeholder="e.g., 550e8400-e29b-41d4-a716-446655440000"
          onChange={(e) => setPolicyId(e.target.value)}
        />
      </div>
      
      <div className="flex-1 overflow-y-auto border p-4 bg-white rounded shadow">{messages.map((msg, i) => (
          <div
            key={i}
            className={`my-2 p-3 rounded-lg max-w-[80%] ${
              msg.role === "assistant"
                ? "bg-gray-100 text-gray-900"
                : "bg-blue-600 text-white ml-auto"
            }`}
            style={msg.role === "user" ? { marginLeft: "auto" } : {}}
          >
            {msg.content}
          </div>
        ))}
        {loading && (
          <div className="my-2 p-3 rounded-lg max-w-[80%] bg-gray-100 text-gray-900">
            Thinking...
          </div>
        )}
      </div>

      <div className="mt-4 flex">
        <input
          className="flex-1 border p-2 rounded-l"
          value={input}
          placeholder="Ask about a policy..."
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !loading && sendMessage()}
          disabled={loading}
        />
        <button 
          className="px-4 bg-blue-600 text-white rounded-r disabled:opacity-50" 
          onClick={sendMessage}
          disabled={loading}
        >
          {loading ? "..." : "Send"}
        </button>
      </div>
    </div>
  );
}
