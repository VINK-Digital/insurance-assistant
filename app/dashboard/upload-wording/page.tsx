"use client";

import { useState, useEffect } from "react";

// Predefined insurers + wording versions
const insurerOptions = [
  { name: "DUAL Australia Pty Limited", defaultVersion: "11.20" },
  { name: "Agile Underwriting Services Pty Ltd", defaultVersion: "2019" },
  { name: "QBE Insurance Australia Limited", defaultVersion: "General" },
  { name: "Chubb Insurance Australia Limited", defaultVersion: "2021" },
];

export default function UploadWordingPage() {
  const [file, setFile] = useState<File | null>(null);
  const [insurer, setInsurer] = useState("");
  const [wordingVersion, setWordingVersion] = useState("");
  const [status, setStatus] = useState<
    "idle" | "uploading" | "extracting" | "saving" | "done" | "error"
  >("idle");
  const [progress, setProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState("");

  // Auto-fill wording version when insurer is selected
  useEffect(() => {
    const found = insurerOptions.find((i) => i.name === insurer);
    if (found) setWordingVersion(found.defaultVersion);
  }, [insurer]);

  // Smooth progress bar state changes
  useEffect(() => {
    if (status === "idle") setProgress(0);
    if (status === "uploading") setProgress(30);
    if (status === "extracting") setProgress(55);
    if (status === "saving") setProgress(85);
    if (status === "done") setProgress(100);
    if (status === "error") setProgress(100);
  }, [status]);

  const statusText = {
    idle: "Waiting for upload…",
    uploading: "Uploading wording PDF…",
    extracting: "Extracting text from document…",
    saving: "Saving wording to database…",
    done: "Wording uploaded successfully!",
    error: errorMessage || "Upload failed",
  };

  async function handleUpload() {
    if (!file || !insurer || !wordingVersion) {
      setErrorMessage("Please fill all fields and select a file.");
      setStatus("error");
      return;
    }

    try {
      setStatus("uploading");
      setErrorMessage("");

      const formData = new FormData();
      formData.append("file", file);
      formData.append("insurer", insurer);
      formData.append("wordingVersion", wordingVersion);

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
      <h1 className="text-3xl font-bold mb-6 text-gray-900">
        Upload Policy Wording
      </h1>

      <div className="bg-white shadow-lg rounded-xl p-6 border border-gray-200 space-y-6">

        {/* Insurer Dropdown */}
        <div>
          <label className="block text-sm font-semibold mb-1 text-gray-700">
            Select Insurer
          </label>
          <select
            className="w-full border rounded-lg p-2 bg-gray-50"
            value={insurer}
            onChange={(e) => setInsurer(e.target.value)}
          >
            <option value="">-- Choose an insurer --</option>
            {insurerOptions.map((opt) => (
              <option key={opt.name} value={opt.name}>
                {opt.name}
              </option>
            ))}
          </select>
        </div>

        {/* Wording Version */}
        <div>
          <label className="block text-sm font-semibold mb-1 text-gray-700">
            Wording Version
          </label>
          <input
            type="text"
            value={wordingVersion}
            onChange={(e) => setWordingVersion(e.target.value)}
            placeholder="e.g. 11.20"
            className="w-full border rounded-lg p-2 bg-gray-50"
          />
        </div>

        {/* File Upload */}
        <div>
          <label className="block text-sm font-semibold mb-1 text-gray-700">
            Upload wording PDF
          </label>
          <input
            type="file"
            accept="application/pdf"
            className="w-full text-sm"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
          />
        </div>

        {/* Progress Bar */}
        <div className="pt-2">
          <div className="text-sm font-semibold mb-2 text-gray-700">
            {statusText[status]}
          </div>

          <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
            <div
              className="h-3 bg-green-600 transition-all duration-300"
              style={{ width: `${progress}%` }}
            ></div>
          </div>
        </div>

        {/* Upload Button */}
        <button
          onClick={handleUpload}
          className="w-full py-3 bg-green-700 text-white font-semibold rounded-lg hover:bg-green-800 transition shadow"
        >
          Upload Wording
        </button>

        {/* Error */}
        {status === "error" && (
          <div className="text-red-600 text-sm font-semibold">
            {errorMessage}
          </div>
        )}

      </div>
    </div>
  );
}
