export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      <aside className="w-64 bg-gray-900 text-white p-6 space-y-6">
        <h2 className="text-xl font-bold">Insurance Assistant</h2>

        <nav className="space-y-3">
          <a href="/dashboard/chat" className="block hover:text-blue-300">Chat</a>
          <a href="/dashboard/upload" className="block hover:text-blue-300">Upload PDF</a>
          <a href="/dashboard/policies" className="block hover:text-blue-300">Policies</a>
          <a href="/dashboard/customers" className="block hover:text-blue-300">Customers</a>
        </nav>
      </aside>

      {/* Main content */}
      <main className="flex-1 p-6 bg-gray-100 overflow-auto">
        {children}
      </main>
    </div>
  );
}
