"use client";

import { useState, useEffect } from "react";

export default function UploadPage() {
  const [customers, setCustomers] = useState([]);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);

  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const [newCustomerName, setNewCustomerName] = useState("");

  // Load customers on mount
  useEffect(() => {
    fetch("/api/customers")
      .then((r) => r.json())
      .then((data) => setCustomers(data.customers || []));
  }, []);

  // Auto-select customer from ?customerId=
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const cId = params.get("customerId");
    if (cId) setCustomerId(cId);
  }, []);

  async function uploadPolicy() {
    if (!file || !customerId) return;

    const formData = new FormData();
    formData.append("file", file);
    formData.append("customerId", customerId);

    const res = await fetch("/api/upload", {
      method: "POST",
      body: formData,
    });

    const data = await res.json();
    console.log("Upload result:", data);
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
          {customers.map((c: any) => (
            <option key={c.id} value={c.id}>
              {c.name || c.id}
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

      {/* FILE UPLOAD */}
      <input
        type="file"
        className="border p-2 rounded w-full"
        onChange={(e) => setFile(e.target.files?.[0] || null)}
      />

      <button
        onClick={uploadPolicy}
        className="mt-4 w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700"
      >
        Upload Policy
      </button>

      {/* ADD CUSTOMER MODAL */}
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
