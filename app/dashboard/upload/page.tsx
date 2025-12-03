"use client";

import { useEffect, useState } from "react";

export default function UploadPage() {
  const [customers, setCustomers] = useState([]);
  const [selectedCustomer, setSelectedCustomer] = useState("");
  const [newCustomerName, setNewCustomerName] = useState("");

  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState("");

  // Load existing customers on first render
  useEffect(() => {
    async function loadCustomers() {
      const res = await fetch("/api/customers");
      const data = await res.json();
      setCustomers(data);
    }
    loadCustomers();
  }, []);

  async function handleUpload() {
    setStatus("");

    if (!file) {
      setStatus("Please select a file");
      return;
    }

    let customerId = selectedCustomer;

    // Create new customer if user typed name
    if (!customerId && newCustomerName.trim()) {
      const res = await fetch("/api/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newCustomerName }),
      });

      const created = await res.json();
      customerId = created.id;
    }

    if (!customerId) {
      setStatus("Please select or create a customer");
      return;
    }

    // Send file + customer_id to n8n webhook
    const form = new FormData();
    form.append("file0", file);
    form.append("customer_id", customerId);

    const webhookURL = process.env.NEXT_PUBLIC_N8N_WEBHOOK_URL;

    const upload = await fetch(webhookURL!, {
      method: "POST",
      body: form,
    });

    if (upload.ok) {
      setStatus("Upload successful! Policy is now being processed.");
      setFile(null);
      setSelectedCustomer("");
      setNewCustomerName("");
    } else {
      setStatus("Upload failed.");
    }
  }

  return (
    <div className="max-w-xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-4">Upload Policy Schedule</h1>

      {/* Customer selection */}
      <label className="block font-semibold mb-1">Select Customer</label>
      <select
        className="border p-2 rounded w-full mb-3"
        value={selectedCustomer}
        onChange={(e) => setSelectedCustomer(e.target.value)}
      >
        <option value="">-- Choose Existing Customer --</option>
        {customers.map((c: any) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>

      <div className="text-center py-2 text-gray-500">OR</div>

      {/* Create new customer */}
      <input
        className="border p-2 rounded w-full mb-3"
        placeholder="Create New Customer"
        value={newCustomerName}
        onChange={(e) => setNewCustomerName(e.target.value)}
      />

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
        Upload Policy
      </button>

      {status && (
        <p className="mt-4 text-center text-sm text-gray-700">{status}</p>
      )}
    </div>
    <button
  onClick={() => setShowNewCustomer(true)}
  className="px-4 py-2 bg-green-700 text-white rounded-lg shadow hover:bg-green-800"
>
  + Add Customer
</button>
const [showNewCustomer, setShowNewCustomer] = useState(false);
const [newCustomerName, setNewCustomerName] = useState("");
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
async function createCustomer() {
  if (!newCustomerName.trim()) return;

  const res = await fetch("/api/customers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: newCustomerName }),
  });

  const data = await res.json();

  if (data.customer?.id) {
    // select new customer
    setCustomerId(data.customer.id);

    // close modal
    setShowNewCustomer(false);
    setNewCustomerName("");

    // reload customers
    setCustomers((prev) => [...prev, data.customer]);
  }
}


  );
}
