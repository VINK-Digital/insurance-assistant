"use client";

import { useState, useEffect } from "react";

const insurerOptions = [
  { name: "DUAL Australia Pty Limited", defaultVersion: "11.20" },
  { name: "Agile Underwriting Services Pty Ltd", defaultVersion: "2019" },
];

export default function UploadWordingPage() {
  const [file, setFile] = useState<File | null>(null);
  const [insurer, setInsurer] = useState("");
  const [wordingVersion, setWordingVersion] = useState("");
  const [status, setStatus] = useState<
    "idle" | "extracting" | "uploading" | "saving" | "done" | "error"
  >("idle");
  const [progress, setProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    const found = insurerOptions.find((i) => i.name === insurer);
    if (found) setWordingVersion(found.defaultVersion);
  }, [insurer]);

  useEffect(() => {
    if (status === "idle") setProgress(0);
    if (status === "extracting") setProgress(40);
    if (status === "uploading") setProgress(65);
    if (status === "saving") setProgress(85);
    if (status === "done") setProgress(100);
    if (status === "error") setProgress(100);
  }, [status]);

  async function extractTextClientSide(pdfFile: File): Promise<string> {
    setStatus("extracting");

    const openai = new (require("openai").OpenAI)({
      apiKey: process.env.NEXT_PUBLIC_OPENAI_API_KEY!,
    });

    // Upload PDF to OpenAI
    const uploaded = await openai.files.create({
      file: pdfFile,
      purpose: "assistants",
    });

    // Extract wording using GPT-5-mini
    const extraction = await openai.responses.create({
      model: "gpt-5-mini",
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text:
                "Extract the FULL wording text from this PDF. Return ONLY the plain text wording. No summaries.",
            },
            { type: "input_file", file_id: uploaded.id },
          ],
        },
      ],
    });

    return extraction.output_text || "";
  }

  async function handleUpload() {
    try {
      if (!file || !insurer || !wordingVersion) {
        setErrorMessage("Please fill all fields and select a file.");
        setStatus("error");
        return;
      }

      // 1) Extract text client-side
      const extractedText = await extractTextClientSide(file);

      setStatus("uploading");

      // 2) Upload to backend
      const formData = new FormData();
      formData.append("file", file);
      formData.append("insurer", insurer);
      formData.append("wordingVersion", wordingVersion);
      formData.append("extractedText", extractedText);

      setStatus("saving");

      const res = await fetch("/api/upload-wording", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const json = await res.json();
        setErrorMessage(json.error || "Upload failed");
        setStatus("error");
        return;
      }

      setStatus("done");
    } catch (err: any) {
      setErrorMessage(err.message || "Unexpected error");
      setStatus("error");
    }
  }

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <h1 className="text-3xl font-bold mb-6">Upload Policy Wording</h1>

      <div className="bg-white shadow-lg rounded-xl p-6 border border-gray-200 space-y-6">
        {/* Insurer Dropdown */}
        <div>
          <label className="block text-sm font-semibold mb-1">
            Select Insurer
          </label>
          <select
            className="w-full border rounded-lg p-2 bg-gray-50"
            value={insurer}
            onChange={(e) => setInsurer(e.target.value)}
          >
            <option value="">Choose insurer</option>
            {insurerOptions.map((i) => (
              <option key={i.name} value={i.name}>
                {i.name}
              </option>
            ))}
          </select>
        </div>

        {/* Wording Version */}
        <div>
          <label className="block text-sm font-semibold mb-1">
            Wording Version
          </label>
          <input
            className="w-full border rounded-lg p-2 bg-gray-50"
            value={wordingVersion}
            onChange={(e) => setWordingVersion(e.target.value)}
            placeholder="e.g. 11.20"
          />
        </div>

        {/* File Upload */}
        <div>
          <label className="block text-sm font-semibold mb-1">
            Upload Policy Wording PDF
          </label>
          <input
            type="file"
            accept="application/pdf"
            className="w-full text-sm"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
          />
        </div>

        {/* Progress */}
        <div>
          <div className="text-sm font-semibold mb-1">
            {status === "idle" ? "Waiting…" : status.replace("-", " ")}
          </div>
          <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
            <div
              className="h-3 bg-green-600 transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {/* Upload button */}
        <button
          onClick={handleUpload}
          className="w-full py-3 bg-green-700 text-white font-semibold rounded-lg hover:bg-green-800 transition shadow"
        >
          Upload Wording
        </button>

        {status === "error" && (
          <div className="text-red-600 text-sm font-semibold">
            {errorMessage}
          </div>
        )}

        {status === "done" && (
          <div className="text-green-700 text-sm font-semibold">
            ✓ Wording uploaded successfully
          </div>
        )}
      </div>
    </div>
  );
}
