"use client";

import { useState, useEffect, useRef } from "react";

export default function ChatPage() {
  const [messages, setMessages] = useState<any[]>([]);
  const [input, setInput] = useState("");
  const [policies, setPolicies] = useState<any[]>([]);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [lastPolicyId, setLastPolicyId] = useState<string | null>(null);
  const [clarification, setClarification] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Load customer & policies
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const custId = params.get("customerId");
    setCustomerId(custId);

    if (!custId) return;

    fetch(`/api/customers?customerId=${custId}`)
      .then((r) => r.json())
      .then((data) => {
        setPolicies(data.policies || []);
      });
  }, []);

  async function sendMessage() {
    if (!input.trim()) return;

    const userMsg = { role: "user", content: input };
    setMessages((prev) => [...prev, userMsg]);

    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: input,
        customerId,
        policies,
        lastPolicyId,
      }),
    });

    const data = await res.json();

    if (data.clarification) {
      setClarification(data.question);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: data.question },
      ]);
      setInput("");
      return;
    }

    if (data.selectedPolicyId) {
      setLastPolicyId(data.selectedPolicyId);
    }

    setMessages((prev) => [
      ...prev,
      { role: "assistant", content: data.answer },
    ]);

    setInput("");
  }

  async function handleClarification() {
    const answer = input.trim();
    if (!answer) return;

    setInput("");
    setClarification(null);

    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: answer,
        customerId,
        policies,
        lastPolicyId,
        clarification: true,
      }),
    });

    const data = await res.json();

    if (data.selectedPolicyId) {
      setLastPolicyId(data.selectedPolicyId);
    }

    setMessages((prev) => [
      ...prev,
      { role: "assistant", content: data.answer },
    ]);
  }

  return (
    <div className="w-full min-h-screen bg-gray-100 flex justify-center p-6">
      <div className="w-full max-w-3xl bg-white shadow-lg rounded-xl flex flex-col border border-gray-200">
        
        {/* Header */}
        <div className="p-4 border-b border-gray-200 bg-white rounded-t-xl">
          <h1 className="text-2xl font-semibold text-gray-800">
            Policy Assistant
          </h1>
          <p className="text-gray-500 text-sm">
            Ask anything about your customer’s policies.
          </p>
        </div>

        {/* Chat Messages */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-gray-50">
          {messages.map((msg, i) => (
            <div
              key={i}
              className={`flex ${
                msg.role === "user" ? "justify-end" : "justify-start"
              }`}
            >
              <div
                className={`max-w-[75%] px-4 py-3 rounded-2xl shadow-sm text-sm leading-relaxed ${
                  msg.role === "user"
                    ? "bg-green-600 text-white rounded-br-none"
                    : "bg-white text-gray-800 border rounded-bl-none"
                }`}
              >
                {msg.content}
              </div>
            </div>
          ))}

          <div ref={scrollRef} />
        </div>

        {/* Input Box */}
        <div className="p-4 border-t border-gray-200 bg-white rounded-b-xl">
          <div className="flex gap-3">
            <input
              className="flex-1 border border-gray-300 bg-gray-50 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-green-600"
              placeholder={
                clarification
                  ? "Please clarify…"
                  : "Ask about a policy…"
              }
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  clarification ? handleClarification() : sendMessage();
                }
              }}
            />

            <button
              onClick={clarification ? handleClarification : sendMessage}
              className="px-6 bg-green-700 hover:bg-green-800 text-white rounded-lg font-medium shadow-sm transition"
            >
              {clarification ? "Clarify" : "Send"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
