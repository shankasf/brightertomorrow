'use client';
import { useEffect, useState } from 'react';
import AdminShell from '@/components/admin/AdminShell';
import { adminFetch } from '@/components/admin/useAdminAuth';

type NavItem = { id: number; parent_id: number | null; label: string; href: string; position: number; location: string };
type NavForm = Omit<NavItem, 'id'>;
const empty: NavForm = { parent_id: null, label: '', href: '', position: 0, location: 'header' };

export default function NavPage() {
  const [items, setItems] = useState<NavItem[]>([]);
  const [editing, setEditing] = useState<NavItem | null>(null);
  const [form, setForm] = useState<NavForm>(empty);
  const [saving, setSaving] = useState(false);

  const load = () => adminFetch('/admin/content/nav').then((r) => r.json()).then((d) => setItems(d.nav_items));
  useEffect(() => { load(); }, []);

  const save = async () => {
    setSaving(true);
    if (editing) await adminFetch(`/admin/content/nav/${editing.id}`, { method: 'PUT', body: JSON.stringify(form) });
    else await adminFetch('/admin/content/nav', { method: 'POST', body: JSON.stringify(form) });
    setSaving(false); setEditing(null); setForm(empty); load();
  };
  const del = async (id: number) => {
    if (!confirm('Delete nav item?')) return;
    await adminFetch(`/admin/content/nav/${id}`, { method: 'DELETE' }); load();
  };

  return (
    <AdminShell>
      <div className="p-6 max-w-4xl">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Navigation</h1>
          <button onClick={() => { setEditing(null); setForm(empty); }} className="bg-blue-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-blue-700">+ Add Item</button>
        </div>

        {(editing !== null || form.label !== '') && (
          <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Label</label>
                <input className="w-full border rounded-lg px-3 py-2 text-sm" value={form.label}
                  onChange={(e) => setForm({ ...form, label: e.target.value })} />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Href</label>
                <input className="w-full border rounded-lg px-3 py-2 text-sm" value={form.href}
                  onChange={(e) => setForm({ ...form, href: e.target.value })} />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Location</label>
                <select className="w-full border rounded-lg px-3 py-2 text-sm" value={form.location}
                  onChange={(e) => setForm({ ...form, location: e.target.value })}>
                  <option value="header">Header</option>
                  <option value="footer">Footer</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Parent</label>
                <select className="w-full border rounded-lg px-3 py-2 text-sm"
                  value={form.parent_id ?? ''}
                  onChange={(e) => setForm({ ...form, parent_id: e.target.value ? +e.target.value : null })}>
                  <option value="">No parent</option>
                  {items.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Position</label>
                <input type="number" className="w-full border rounded-lg px-3 py-2 text-sm" value={form.position}
                  onChange={(e) => setForm({ ...form, position: +e.target.value })} />
              </div>
            </div>
            <div className="flex gap-2">
              <button disabled={saving} onClick={save} className="bg-blue-600 text-white text-sm px-4 py-2 rounded-lg disabled:opacity-40">{saving ? 'Saving…' : 'Save'}</button>
              <button onClick={() => { setEditing(null); setForm(empty); }} className="text-sm px-4 py-2 rounded-lg border">Cancel</button>
            </div>
          </div>
        )}

        <div className="space-y-2">
          {['header', 'footer'].map((loc) => (
            <div key={loc}>
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 mt-4">{loc}</div>
              {items.filter((i) => i.location === loc).map((item) => (
                <div key={item.id} className="bg-white rounded-xl border border-gray-100 p-4 flex items-center justify-between gap-4 mb-1">
                  <div>
                    <span className="text-sm font-medium text-gray-900">{item.label}</span>
                    <span className="text-xs text-gray-400 ml-2 font-mono">{item.href}</span>
                    {item.parent_id && <span className="text-xs text-gray-400 ml-2">↳ child</span>}
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => { setEditing(item); setForm({ parent_id: item.parent_id, label: item.label, href: item.href, position: item.position, location: item.location }); }} className="text-xs text-blue-600 hover:underline">Edit</button>
                    <button onClick={() => del(item.id)} className="text-xs text-red-600 hover:underline">Delete</button>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </AdminShell>
  );
}
