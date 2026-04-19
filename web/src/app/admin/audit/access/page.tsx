'use client';
import { useEffect, useState } from 'react';
import AdminShell from '@/components/admin/AdminShell';
import { adminFetch } from '@/components/admin/useAdminAuth';

type AccessEntry = {
  id: number; event_time: string; admin_email: string;
  action: string; resource_type: string; resource_id: string | null; ip_address: string | null;
};

export default function AdminAccessLogPage() {
  const [data, setData] = useState<{ data: AccessEntry[]; total: number } | null>(null);
  const [page, setPage] = useState(1);

  useEffect(() => {
    adminFetch(`/admin/audit/access?page=${page}&limit=50`)
      .then((r) => r.json())
      .then(setData);
  }, [page]);

  return (
    <AdminShell>
      <div className="p-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Admin Access Log</h1>
        <p className="text-sm text-gray-500 mb-6">
          Every admin read of PHI is recorded here (HIPAA §164.312(b)). Append-only.
        </p>

        {data ? (
          <>
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="text-left px-4 py-3 text-gray-500 font-medium">Time</th>
                    <th className="text-left px-4 py-3 text-gray-500 font-medium">Admin</th>
                    <th className="text-left px-4 py-3 text-gray-500 font-medium">Action</th>
                    <th className="text-left px-4 py-3 text-gray-500 font-medium">Resource</th>
                    <th className="text-left px-4 py-3 text-gray-500 font-medium">IP</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {data.data.map((e) => (
                    <tr key={e.id} className="hover:bg-gray-50">
                      <td className="px-4 py-2 text-xs text-gray-500 font-mono">{e.event_time.slice(0, 19).replace('T', ' ')}</td>
                      <td className="px-4 py-2 text-xs text-gray-700">{e.admin_email}</td>
                      <td className="px-4 py-2 text-xs font-mono text-blue-700">{e.action}</td>
                      <td className="px-4 py-2 text-xs text-gray-600">
                        {e.resource_type}{e.resource_id ? ` #${e.resource_id}` : ''}
                      </td>
                      <td className="px-4 py-2 text-xs text-gray-500 font-mono">{e.ip_address ?? '—'}</td>
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
                <button disabled={page * 50 >= data.total} onClick={() => setPage(p => p + 1)}
                  className="px-3 py-1 rounded border disabled:opacity-40 hover:bg-gray-50">Next →</button>
              </div>
            </div>
          </>
        ) : <div className="text-gray-400">Loading…</div>}
      </div>
    </AdminShell>
  );
}
