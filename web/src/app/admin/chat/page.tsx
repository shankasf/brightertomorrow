'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import AdminShell from '@/components/admin/AdminShell';
import { adminFetch } from '@/components/admin/useAdminAuth';

type Session = {
  id: string; visitor_id: string | null; started_at: string;
  ended_at: string | null; message_count: number; purged_at: string | null;
};

export default function AdminChatPage() {
  const [data, setData] = useState<{ data: Session[]; total: number } | null>(null);
  const [page, setPage] = useState(1);

  useEffect(() => {
    adminFetch(`/admin/chat/sessions?page=${page}&limit=25`)
      .then((r) => r.json())
      .then(setData);
  }, [page]);

  return (
    <AdminShell>
      <div className="p-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Chat Sessions</h1>

        {data ? (
          <>
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="text-left px-4 py-3 text-gray-500 font-medium">Session ID</th>
                    <th className="text-left px-4 py-3 text-gray-500 font-medium">Started</th>
                    <th className="text-left px-4 py-3 text-gray-500 font-medium">Ended</th>
                    <th className="text-left px-4 py-3 text-gray-500 font-medium">Messages</th>
                    <th className="text-left px-4 py-3 text-gray-500 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {data.data.map((s) => (
                    <tr key={s.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 font-mono text-xs">
                        <Link href={`/admin/chat/${s.id}`} className="text-blue-600 hover:underline">
                          {s.id.slice(0, 8)}…
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{s.started_at.slice(0, 16).replace('T', ' ')}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{s.ended_at ? s.ended_at.slice(0, 16).replace('T', ' ') : '—'}</td>
                      <td className="px-4 py-3 text-center">{s.message_count}</td>
                      <td className="px-4 py-3">
                        {s.purged_at ? (
                          <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">Anonymized</span>
                        ) : s.ended_at ? (
                          <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">Ended</span>
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
