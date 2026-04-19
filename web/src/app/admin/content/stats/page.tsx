'use client';
import { useEffect, useState } from 'react';
import AdminShell from '@/components/admin/AdminShell';
import { adminFetch } from '@/components/admin/useAdminAuth';

type Stat = { id: number; label: string; value: string; suffix: string | null; position: number };

export default function StatsPage() {
  const [stats, setStats] = useState<Stat[]>([]);
  const [editing, setEditing] = useState<number | null>(null);
  const [forms, setForms] = useState<Record<number, Stat>>({});
  const [saving, setSaving] = useState<number | null>(null);

  const load = () =>
    adminFetch('/admin/content/stats').then((r) => r.json()).then((d) => {
      setStats(d.stats);
      const map: Record<number, Stat> = {};
      d.stats.forEach((s: Stat) => { map[s.id] = { ...s }; });
      setForms(map);
    });

  useEffect(() => { load(); }, []);

  const save = async (id: number) => {
    setSaving(id);
    await adminFetch(`/admin/content/stats/${id}`, { method: 'PUT', body: JSON.stringify(forms[id]) });
    setSaving(null);
    setEditing(null);
    load();
  };

  return (
    <AdminShell>
      <div className="p-6 max-w-3xl">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Homepage Stats</h1>
        <p className="text-sm text-gray-500 mb-6">These counters appear on the homepage. Edit values in-line.</p>

        <div className="space-y-2">
          {stats.map((s) => (
            <div key={s.id} className="bg-white rounded-xl border border-gray-100 p-4">
              {editing === s.id ? (
                <div className="flex items-center gap-3">
                  <input className="border rounded-lg px-3 py-1.5 text-sm flex-1" value={forms[s.id]?.label ?? ''}
                    onChange={(e) => setForms((f) => ({ ...f, [s.id]: { ...f[s.id], label: e.target.value } }))} placeholder="Label" />
                  <input className="border rounded-lg px-3 py-1.5 text-sm w-24" value={forms[s.id]?.value ?? ''}
                    onChange={(e) => setForms((f) => ({ ...f, [s.id]: { ...f[s.id], value: e.target.value } }))} placeholder="Value" />
                  <input className="border rounded-lg px-3 py-1.5 text-sm w-16" value={forms[s.id]?.suffix ?? ''}
                    onChange={(e) => setForms((f) => ({ ...f, [s.id]: { ...f[s.id], suffix: e.target.value || null } }))} placeholder="Suffix" />
                  <button disabled={saving === s.id} onClick={() => save(s.id)}
                    className="bg-blue-600 text-white text-xs px-3 py-1.5 rounded-lg disabled:opacity-40">
                    {saving === s.id ? '…' : 'Save'}
                  </button>
                  <button onClick={() => setEditing(null)} className="text-xs text-gray-500 hover:underline">Cancel</button>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-xl font-bold text-gray-900">{s.value}{s.suffix}</span>
                    <span className="text-sm text-gray-500 ml-3">{s.label}</span>
                  </div>
                  <button onClick={() => setEditing(s.id)} className="text-xs text-blue-600 hover:underline">Edit</button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </AdminShell>
  );
}
