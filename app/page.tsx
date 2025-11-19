"use client";

import { useState } from "react";

export default function Page() {
  const [messages, setMessages] = useState([
    { role: "assistant", content: "Hi! I'm your Insurance AI assistant. How can I help?" }
  ]);

  const [input, setInput] = useState("");

  async function sendMessage() {
    if (!input.trim()) return;

    const newMessage = { role: "user", content: input };
    const updatedMessages = [...messages, newMessage];
    setMessages(updatedMessages);
    setInput("");

    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: updatedMessages }),
    });

    const data = await res.json();

    setMessages([...updatedMessages, { role: "assistant", content: data.answer }]);
  }

  return (
    <div className="max-w-2xl mx-auto p-6 h-screen flex flex-col">
      <h1 className="text-2xl font-bold mb-4">Insurance AI Demo</h1>

      <div className="flex-1 overflow-y-auto border p-4 bg-white rounded shadow">
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`my-2 p-3 rounded-lg max-w-[80%] ${
              msg.role === "assistant"
                ? "bg-gray-100 text-gray-900"
                : "bg-blue-600 text-white ml-auto"
            }`}
          >
            {msg.content}
          </div>
        ))}
      </div>

      <div className="mt-4 flex">
        <input
          className="flex-1 border p-2 rounded-l"
          value={input}
          placeholder="Ask about a policy..."
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && sendMessage()}
        />
        <button className="px-4 bg-blue-600 text-white rounded-r" onClick={sendMessage}>
          Send
        </button>
      </div>
    </div>
  );
}
