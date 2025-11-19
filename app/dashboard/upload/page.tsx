 "use client";

import { useState } from "react";

export default function UploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");

  const handleUpload = async () => {
    if (!file) {
      setMessage("Please select a PDF first.");
      return;
    }

    setUploading(true);
    setMessage("");

    const formData = new FormData();
    formData.append("file", file);

    try {
      // Send to your API route → which will later send to n8n
      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      setMessage(data.message || "Uploaded successfully!");

    } catch (error) {
      console.error(error);
      setMessage("Upload failed.");
    }

    setUploading(false);
  };

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-6">Upload Policy PDF</h1>

      <label className="border-dashed border-2 border-gray-400 p-10 rounded-lg flex flex-col items-center justify-center cursor-pointer bg-white">
        <input
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={(e) => {
            if (e.target.files) setFile(e.target.files[0]);
          }}
        />
        <span className="text-gray-600">Drag & drop a PDF file here</span>
        <span className="mt-2 text-sm text-gray-500">or click to select</span>
      </label>

      {file && (
        <p className="mt-4 text-gray-700">Selected file: {file.name}</p>
      )}

      <button
        onClick={handleUpload}
        disabled={uploading}
        className="mt-6 px-4 py-2 bg-blue-600 text-white rounded-lg disabled:opacity-50"
      >
        {uploading ? "Uploading..." : "Upload PDF"}
      </button>

      {message && (
        <p className="mt-4 text-gray-700 font-medium">{message}</p>
      )}
    </div>
  );
}
