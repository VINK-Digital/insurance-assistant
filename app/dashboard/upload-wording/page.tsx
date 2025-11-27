"use client";

import { useState } from "react";

export default function UploadWordingPage() {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState("");

  async function handleUpload() {
    setStatus("");

    if (!file) {
      setStatus("Please select a PDF file");
      return;
    }

    const form = new FormData();
    form.append("file0", file);

    const webhook = process.env.NEXT_PUBLIC_N8N_WORDING_WEBHOOK;

    const res = await fetch(webhook!, {
      method: "POST",
      body: form,
    });

    if (res.ok) {
      setStatus("Wording uploaded successfully!");
      setFile(null);
    } else {
      setStatus("Upload failed.");
    }
  }

  return (
    <div className="max-w-xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-4">Upload Policy Wording</h1>

      {/* File upload */}
      <label className="block font-semibold mb-1">Select PDF</label>
      <input
        type="file"
        accept="application/pdf"
        className="border p-2 rounded w-full mb-4"
        onChange={(e) => setFile(e.target.files?.[0] || null)}
      />

      <button
        onClick={handleUpload}
        className="bg-blue-600 text-white px-4 py-2 rounded w-full"
      >
        Upload Wording
      </button>

      {status && (
        <p className="mt-4 text-center text-gray-700">{status}</p>
      )}
    </div>
  );
}
