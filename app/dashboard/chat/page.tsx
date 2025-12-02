"use client";

import { useState, useEffect } from "react";

export default function ChatPage() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [policies, setPolicies] = useState([]);
  const [customerId, setCustomerId] = useState(null);
  const [lastPolicyId, setLastPolicyId] = useState(null);
  const [clarification, setClarification] = useState(null);

  // Load customer & policies on mount
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

  // Send message to backend
  async function sendMessage() {
    if (!input) return;

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

    // If API needs user clarification
    if (data.clarification) {
      setClarification(data.question);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: data.question },
      ]);
      return;
    }

    // Save selected policy for memory
    if (data.selectedPolicyId) {
      setLastPolicyId(data.selectedPolicyId);
    }

    // Add assistant message
    setMessages((prev) => [
      ...prev,
      { role: "assistant", content: data.answer },
    ]);

    setInput("");
  }

  // When clarification is pending, treat next user reply as the answer
  async function handleClarification() {
    const answer = input;
    setInput("");
    setClarification(null);

    // Send clarification + original context
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

    setLastPolicyId(data.selectedPolicyId);

    setMessages((prev) => [
      ...prev,
      { role: "assistant", content: data.answer },
    ]);
  }

  return (
    <div className="p-6">
      <h1 className="text-xl font-bold">Policy Assistant Chat</h1>

      {/* Messages */}
      <div className="mt-4 space-y-3">
        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "text-blue-600" : "text-green-700"}>
            <b>{m.role}:</b> {m.content}
          </div>
        ))}
      </div>

      {/* Input */}
      <div className="mt-4 flex gap-2">
        <input
          className="flex-1 border p-2"
          placeholder="Ask about a policy…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />

        <button
          onClick={clarification ? handleClarification : sendMessage}
          className="px-4 py-2 bg-blue-600 text-white rounded"
        >
          {clarification ? "Clarify" : "Send"}
        </button>
      </div>
    </div>
  );
}
