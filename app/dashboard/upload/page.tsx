"use client";

import { useState, useEffect } from "react";

type Customer = {
  id: string;
  name: string;
};

type Wording = {
  id: string;
  insurer: string | null;
  wording_version: string | null;
};

export default function UploadPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);

  // ⭐ NEW: selected wording
  const [wordings, setWordings] = useState<Wording[]>([]);
  const [selectedWordingId, setSelectedWordingId] = useState<string | null>(null);

  // Status
  const [status, setStatus] = useState<string>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Modal
  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const [newCustomerName, setNewCustomerName] = useState("");

  // Load customers
  useEffect(() => {
    fetch("/api/customers")
      .then((r) => r.json())
      .then((data) => setCustomers(data.customers || []));
  }, []);

  // ⭐ NEW: Load wordings
  useEffect(() => {
    fetch("/api/wordings")
      .then((r) => r.json())
      .then((data) => setWordings(data.wordings || []));
  }, []);

  // Auto-select ?customerId
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const cid = params.get("customerId");
    if (cid) setCustomerId(cid);
  }, []);

  async function uploadPolicy() {
    if (!file || !customerId) return;

    setStatus("uploading");
    setErrorMsg(null);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("customerId", customerId);

    // ⭐ NEW: send wordingId
    if (selectedWordingId) {
      formData.append("wordingId", selectedWordingId);
    }

    try {
      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        setStatus("error");
        const err = await res.json();
        setErrorMsg(err.error || "Upload failed");
        return;
      }

      setStatus("parsing");

      const data = await res.json();
      console.log("UPLOAD RESULT:", data);

      if (data.extracted) {
        setStatus("matching");
      }

      setTimeout(() => setStatus("done"), 600);
    } catch (err: any) {
      setStatus("error");
      setErrorMsg(String(err.message || err));
    }
  }

  async function createCustomer() {
    if (!newCustomerName.trim()) return;

    const res = await fetch("/api/customers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newCustomerName }),
    });

    const data = await res.json();

    if (data.customer?.id) {
      setCustomerId(data.customer.id);
      setCustomers((prev) => [...prev, data.customer]);
      setShowNewCustomer(false);
      setNewCustomerName("");
    }
  }

  // STATUS COMPONENT
  const renderStatus = () => {
    const common = "mt-4 p-3 rounded text-white font-medium";

    switch (status) {
      case "uploading":
        return <div className={`${common} bg-blue-600`}>Uploading file…</div>;
      case "parsing":
        return (
          <div className={`${common} bg-purple-600`}>
            Extracting structured data…
          </div>
        );
      case "matching":
        return (
          <div className={`${common} bg-teal-600`}>
            Matching policy wording…
          </div>
        );
      case "done":
        return (
          <div className={`${common} bg-green-600`}>
            Upload complete ✓
          </div>
        );
      case "error":
        return (
          <div className={`${common} bg-red-600`}>
            Error: {errorMsg || "Something went wrong"}
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Upload Policy</h1>

      {/* CUSTOMER SELECT */}
      <label className="text-sm font-medium">Select Customer</label>
      <div className="flex gap-2 mb-4 mt-2">
        <select
          className="flex-1 border p-2 rounded"
          value={customerId || ""}
          onChange={(e) => setCustomerId(e.target.value)}
        >
          <option value="">Choose customer...</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>

        <button
          onClick={() => setShowNewCustomer(true)}
          className="px-4 py-2 bg-green-700 text-white rounded-lg shadow hover:bg-green-800"
        >
          + Add Customer
        </button>
      </div>

      {/* ⭐ NEW: WORDING SELECTOR */}
      <label className="text-sm font-medium">Select Policy Wording</label>
      <select
        className="w-full border p-2 rounded mb-4 mt-2"
        value={selectedWordingId || ""}
        onChange={(e) => setSelectedWordingId(e.target.value)}
      >
        <option value="">Choose wording...</option>

        {wordings.map((w) => (
          <option key={w.id} value={w.id}>
            {w.insurer || "Unknown"} — {w.wording_version || "No version"}
          </option>
        ))}
      </select>

      {/* FILE INPUT */}
      <input
        type="file"
        className="border p-2 rounded w-full"
        onChange={(e) => setFile(e.target.files?.[0] || null)}
      />

      {/* UPLOAD BUTTON */}
      <button
        onClick={uploadPolicy}
        className="mt-4 w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700"
      >
        Upload Policy
      </button>

      {/* STATUS */}
      {renderStatus()}

      {/* MODAL */}
      {showNewCustomer && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center">
          <div className="bg-white p-6 shadow-xl rounded-lg w-full max-w-sm">
            <h2 className="text-xl font-semibold mb-4">Add New Customer</h2>

            <input
              className="w-full border p-2 rounded mb-4"
              placeholder="Customer name"
              value={newCustomerName}
              onChange={(e) => setNewCustomerName(e.target.value)}
            />

            <div className="flex justify-end gap-2">
              <button
                className="px-4 py-2 bg-gray-300 rounded"
                onClick={() => setShowNewCustomer(false)}
              >
                Cancel
              </button>

              <button
                className="px-4 py-2 bg-green-700 text-white rounded"
                onClick={createCustomer}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
