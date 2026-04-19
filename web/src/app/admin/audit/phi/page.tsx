'use client';
import { useEffect, useState } from 'react';
import AdminShell from '@/components/admin/AdminShell';
import { adminFetch } from '@/components/admin/useAdminAuth';

type AuditEntry = {
  id: number; event_time: string; table_name: string;
  operation: string; row_id: string; actor: string; app_user: string | null;
};

const opColor: Record<string, string> = {
  INSERT: 'bg-green-100 text-green-700',
  UPDATE: 'bg-amber-100 text-amber-700',
  DELETE: 'bg-red-100 text-red-700',
};

export default function PHIAuditLogPage() {
  const [data, setData] = useState<{ data: AuditEntry[]; total: number } | null>(null);
  const [page, setPage] = useState(1);

  useEffect(() => {
    adminFetch(`/admin/audit/phi?page=${page}&limit=50`)
      .then((r) => r.json())
      .then(setData);
  }, [page]);

  return (
    <AdminShell>
      <div className="p-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">PHI Audit Log</h1>
        <p className="text-sm text-gray-500 mb-6">
          Append-only log of all PHI mutations (HIPAA §164.312(b)). This page view is also logged.
          Message content is redacted from the log per minimum necessary.
        </p>

        {data ? (
          <>
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="text-left px-4 py-3 text-gray-500 font-medium">Time</th>
                    <th className="text-left px-4 py-3 text-gray-500 font-medium">Table</th>
                    <th className="text-left px-4 py-3 text-gray-500 font-medium">Op</th>
                    <th className="text-left px-4 py-3 text-gray-500 font-medium">Row ID</th>
                    <th className="text-left px-4 py-3 text-gray-500 font-medium">Actor</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {data.data.map((e) => (
                    <tr key={e.id} className="hover:bg-gray-50">
                      <td className="px-4 py-2 text-xs text-gray-500 font-mono">{e.event_time.slice(0, 19).replace('T', ' ')}</td>
                      <td className="px-4 py-2 text-xs font-mono text-gray-700">{e.table_name}</td>
                      <td className="px-4 py-2">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${opColor[e.operation] ?? 'bg-gray-100 text-gray-700'}`}>
                          {e.operation}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-xs font-mono text-gray-600">{e.row_id}</td>
                      <td className="px-4 py-2 text-xs text-gray-600">{e.app_user ?? e.actor}</td>
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
