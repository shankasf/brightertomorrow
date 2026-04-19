'use client';
import { useEffect, useState } from 'react';
import AdminShell from '@/components/admin/AdminShell';
import { adminFetch } from '@/components/admin/useAdminAuth';

type PurgeItem = { source: string; row_id: string; retain_until: string };

export default function PurgeQueuePage() {
  const [items, setItems] = useState<PurgeItem[] | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = () => {
    adminFetch('/admin/audit/purge-queue')
      .then((r) => r.json())
      .then((d) => setItems(d.items));
  };

  useEffect(load, []);

  const purge = async (item: PurgeItem) => {
    if (!confirm(`Anonymize ${item.source} #${item.row_id}? This cannot be undone.`)) return;
    const key = `${item.source}:${item.row_id}`;
    setLoading(key);
    setError('');
    const path =
      item.source === 'contact_submissions'
        ? `/admin/audit/purge/contact/${item.row_id}`
        : `/admin/audit/purge/chat/${item.row_id}`;
    const res = await adminFetch(path, { method: 'POST' });
    setLoading(null);
    if (!res.ok) {
      const d = await res.json();
      setError(d.error ?? 'Purge failed');
    } else {
      load();
    }
  };

  return (
    <AdminShell>
      <div className="p-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Purge Queue</h1>
        <p className="text-sm text-gray-500 mb-6">
          Records that have exceeded their 10-year Nevada NRS 629.051 retention period.
          Use the Anonymize button to invoke the right-to-erasure procedure (Nevada NRS 603A).
          This action is irreversible and logged.
        </p>

        {error && <div className="text-red-600 bg-red-50 rounded-lg p-4 mb-4">{error}</div>}

        {items === null ? (
          <div className="text-gray-400">Loading…</div>
        ) : items.length === 0 ? (
          <div className="bg-green-50 border border-green-200 rounded-xl p-6 text-center text-green-700">
            ✓ No records require purging. All retention periods are within compliance.
          </div>
        ) : (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="text-left px-4 py-3 text-gray-500 font-medium">Source</th>
                  <th className="text-left px-4 py-3 text-gray-500 font-medium">Row ID</th>
                  <th className="text-left px-4 py-3 text-gray-500 font-medium">Retain Until</th>
                  <th className="text-left px-4 py-3 text-gray-500 font-medium">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {items.map((item) => {
                  const key = `${item.source}:${item.row_id}`;
                  return (
                    <tr key={key} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-xs font-mono text-gray-700">{item.source}</td>
                      <td className="px-4 py-3 text-xs font-mono">{item.row_id}</td>
                      <td className="px-4 py-3 text-xs text-red-600 font-medium">{item.retain_until.slice(0, 10)}</td>
                      <td className="px-4 py-3">
                        <button
                          disabled={loading === key}
                          onClick={() => purge(item)}
                          className="text-xs bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded disabled:opacity-40 transition-colors"
                        >
                          {loading === key ? 'Processing…' : 'Anonymize'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AdminShell>
  );
}
