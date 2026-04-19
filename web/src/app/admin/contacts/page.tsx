'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import AdminShell from '@/components/admin/AdminShell';
import { adminFetch } from '@/components/admin/useAdminAuth';

type Contact = {
  id: number; full_name: string; email: string; phone: string | null;
  subject: string | null; source: string | null; created_at: string; purged_at: string | null;
};

export default function AdminContactsPage() {
  const [data, setData] = useState<{ data: Contact[]; total: number } | null>(null);
  const [page, setPage] = useState(1);

  useEffect(() => {
    adminFetch(`/admin/contacts?page=${page}&limit=25`)
      .then((r) => r.json())
      .then(setData);
  }, [page]);

  return (
    <AdminShell>
      <div className="p-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Contact Submissions</h1>
        <p className="text-sm text-gray-500 mb-6">
          Message bodies are not shown in this list (HIPAA §164.502(b) minimum necessary).
          Click a row to view the full record — that access is logged.
        </p>

        {data ? (
          <>
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="text-left px-4 py-3 text-gray-500 font-medium">ID</th>
                    <th className="text-left px-4 py-3 text-gray-500 font-medium">Name</th>
                    <th className="text-left px-4 py-3 text-gray-500 font-medium">Email</th>
                    <th className="text-left px-4 py-3 text-gray-500 font-medium">Subject</th>
                    <th className="text-left px-4 py-3 text-gray-500 font-medium">Received</th>
                    <th className="text-left px-4 py-3 text-gray-500 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {data.data.map((c) => (
                    <tr key={c.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 text-gray-400">{c.id}</td>
                      <td className="px-4 py-3">
                        <Link href={`/admin/contacts/${c.id}`} className="font-medium text-blue-600 hover:underline">
                          {c.full_name}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-gray-600">{c.email}</td>
                      <td className="px-4 py-3 text-gray-600">{c.subject ?? '—'}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{c.created_at.slice(0, 16).replace('T', ' ')}</td>
                      <td className="px-4 py-3">
                        {c.purged_at ? (
                          <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">Anonymized</span>
                        ) : (
                          <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">Active</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between mt-4 text-sm text-gray-500">
              <span>{data.total} total</span>
              <div className="flex gap-2">
                <button disabled={page === 1} onClick={() => setPage(p => p - 1)}
                  className="px-3 py-1 rounded border disabled:opacity-40 hover:bg-gray-50">← Prev</button>
                <span className="px-2">Page {page}</span>
                <button disabled={page * 25 >= data.total} onClick={() => setPage(p => p + 1)}
                  className="px-3 py-1 rounded border disabled:opacity-40 hover:bg-gray-50">Next →</button>
              </div>
            </div>
          </>
        ) : <div className="text-gray-400">Loading…</div>}
      </div>
    </AdminShell>
  );
}
