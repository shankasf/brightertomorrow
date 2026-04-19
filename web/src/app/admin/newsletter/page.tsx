'use client';
import { useEffect, useState } from 'react';
import AdminShell from '@/components/admin/AdminShell';
import { adminFetch } from '@/components/admin/useAdminAuth';

type Subscriber = {
  id: number; email: string; created_at: string;
  unsubscribed_at: string | null; deletion_requested_at: string | null;
};

export default function AdminNewsletterPage() {
  const [data, setData] = useState<{ data: Subscriber[]; total: number } | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState<Record<number, boolean>>({});

  const loadData = () => {
    adminFetch(`/admin/newsletter?page=${page}&limit=50`)
      .then((r) => r.json())
      .then(setData);
  };

  useEffect(loadData, [page]);

  const unsubscribe = async (id: number) => {
    if (!confirm('Mark this subscriber as unsubscribed?')) return;
    setLoading((l) => ({ ...l, [id]: true }));
    await adminFetch(`/admin/newsletter/${id}`, { method: 'DELETE' });
    setLoading((l) => ({ ...l, [id]: false }));
    loadData();
  };

  const requestDeletion = async (id: number) => {
    if (!confirm('Mark this email for deletion (Nevada NRS 603A)?')) return;
    setLoading((l) => ({ ...l, [id]: true }));
    await adminFetch(`/admin/newsletter/${id}/request-deletion`, { method: 'POST' });
    setLoading((l) => ({ ...l, [id]: false }));
    loadData();
  };

  return (
    <AdminShell>
      <div className="p-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Newsletter Subscribers</h1>

        {data ? (
          <>
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="text-left px-4 py-3 text-gray-500 font-medium">Email</th>
                    <th className="text-left px-4 py-3 text-gray-500 font-medium">Subscribed</th>
                    <th className="text-left px-4 py-3 text-gray-500 font-medium">Status</th>
                    <th className="text-left px-4 py-3 text-gray-500 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {data.data.map((s) => (
                    <tr key={s.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-900">{s.email}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{s.created_at.slice(0, 10)}</td>
                      <td className="px-4 py-3">
                        {s.deletion_requested_at ? (
                          <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full">Deletion Requested</span>
                        ) : s.unsubscribed_at ? (
                          <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">Unsubscribed</span>
                        ) : (
                          <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">Active</span>
                        )}
                      </td>
                      <td className="px-4 py-3 space-x-2">
                        {!s.unsubscribed_at && !s.deletion_requested_at && (
                          <button
                            disabled={loading[s.id]}
                            onClick={() => unsubscribe(s.id)}
                            className="text-xs text-amber-600 hover:underline disabled:opacity-40"
                          >Unsubscribe</button>
                        )}
                        {!s.deletion_requested_at && (
                          <button
                            disabled={loading[s.id]}
                            onClick={() => requestDeletion(s.id)}
                            className="text-xs text-red-600 hover:underline disabled:opacity-40"
                          >Request Deletion</button>
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
