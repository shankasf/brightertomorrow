'use client';
import { useEffect, useState } from 'react';
import AdminShell from '@/components/admin/AdminShell';
import { adminFetch } from '@/components/admin/useAdminAuth';

type Service = { id: number; slug: string; title: string; short_desc: string | null; long_desc: string | null; image_url: string | null; icon: string | null; position: number; published: boolean };
type ServiceForm = Omit<Service, 'id'>;
const empty: ServiceForm = { slug: '', title: '', short_desc: null, long_desc: null, image_url: null, icon: null, position: 0, published: true };

export default function ServicesPage() {
  const [items, setItems] = useState<Service[]>([]);
  const [editing, setEditing] = useState<Service | null>(null);
  const [form, setForm] = useState<ServiceForm>(empty);
  const [saving, setSaving] = useState(false);

  const load = () => adminFetch('/admin/content/services').then((r) => r.json()).then((d) => setItems(d.services));
  useEffect(() => { load(); }, []);

  const save = async () => {
    setSaving(true);
    if (editing) await adminFetch(`/admin/content/services/${editing.id}`, { method: 'PUT', body: JSON.stringify(form) });
    else await adminFetch('/admin/content/services', { method: 'POST', body: JSON.stringify(form) });
    setSaving(false); setEditing(null); setForm(empty); load();
  };
  const del = async (id: number) => {
    if (!confirm('Delete this service?')) return;
    await adminFetch(`/admin/content/services/${id}`, { method: 'DELETE' }); load();
  };

  return (
    <AdminShell>
      <div className="p-6 max-w-4xl">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Services</h1>
          <button onClick={() => { setEditing(null); setForm(empty); }} className="bg-blue-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-blue-700">+ New Service</button>
        </div>

        {(editing !== null || form.title !== '') && (
          <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              {([['Title', 'title'], ['Slug', 'slug'], ['Icon', 'icon'], ['Image URL', 'image_url']] as const).map(([label, key]) => (
                <div key={key}>
                  <label className="text-xs text-gray-500 mb-1 block">{label}</label>
                  <input className="w-full border rounded-lg px-3 py-2 text-sm" value={(form[key] as string) ?? ''}
                    onChange={(e) => setForm({ ...form, [key]: e.target.value || null })} />
                </div>
              ))}
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Short Description</label>
              <textarea className="w-full border rounded-lg px-3 py-2 text-sm h-16 resize-none" value={form.short_desc ?? ''}
                onChange={(e) => setForm({ ...form, short_desc: e.target.value || null })} />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Long Description</label>
              <textarea className="w-full border rounded-lg px-3 py-2 text-sm h-24 resize-none" value={form.long_desc ?? ''}
                onChange={(e) => setForm({ ...form, long_desc: e.target.value || null })} />
            </div>
            <div className="flex items-center gap-4">
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Position</label>
                <input type="number" className="w-24 border rounded-lg px-3 py-2 text-sm" value={form.position}
                  onChange={(e) => setForm({ ...form, position: +e.target.value })} />
              </div>
              <label className="flex items-center gap-2 text-sm cursor-pointer mt-4">
                <input type="checkbox" checked={form.published} onChange={(e) => setForm({ ...form, published: e.target.checked })} /> Published
              </label>
            </div>
            <div className="flex gap-2">
              <button disabled={saving} onClick={save} className="bg-blue-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-40">{saving ? 'Saving…' : 'Save'}</button>
              <button onClick={() => { setEditing(null); setForm(empty); }} className="text-sm px-4 py-2 rounded-lg border hover:bg-gray-50">Cancel</button>
            </div>
          </div>
        )}

        <div className="space-y-2">
          {items.map((s) => (
            <div key={s.id} className="bg-white rounded-xl border border-gray-100 p-4 flex items-center justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  {s.icon && <span>{s.icon}</span>}
                  <span className="font-medium text-sm text-gray-900">{s.title}</span>
                  {!s.published && <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">Draft</span>}
                </div>
                <div className="text-xs text-gray-500 mt-0.5 font-mono">{s.slug}</div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => { setEditing(s); setForm({ slug: s.slug, title: s.title, short_desc: s.short_desc, long_desc: s.long_desc, image_url: s.image_url, icon: s.icon, position: s.position, published: s.published }); }} className="text-xs text-blue-600 hover:underline">Edit</button>
                <button onClick={() => del(s.id)} className="text-xs text-red-600 hover:underline">Delete</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </AdminShell>
  );
}
