export default function UploadPage() {
  return (
    <div>
      <h1 className="text-xl font-semibold mb-4">Upload Policy PDF</h1>

      <input type="file" accept="application/pdf" />
      <p className="mt-2 text-sm text-gray-600">PDF → sent to n8n → stored in Supabase</p>
    </div>
  );
}
