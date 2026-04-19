'use client';
import { useEffect, useState } from 'react';
import AdminShell from '@/components/admin/AdminShell';
import { adminFetch } from '@/components/admin/useAdminAuth';

type Testimonial = { id: number; author: string; quote: string; rating: number | null; position: number; published: boolean };
type TestimonialForm = Omit<Testimonial, 'id'>;
const empty: TestimonialForm = { author: '', quote: '', rating: null, position: 0, published: true };

export default function TestimonialsPage() {
  const [items, setItems] = useState<Testimonial[]>([]);
  const [editing, setEditing] = useState<Testimonial | null>(null);
  const [form, setForm] = useState<TestimonialForm>(empty);
  const [saving, setSaving] = useState(false);

  const load = () => adminFetch('/admin/content/testimonials').then((r) => r.json()).then((d) => setItems(d.testimonials));
  useEffect(() => { load(); }, []);

  const save = async () => {
    setSaving(true);
    if (editing) await adminFetch(`/admin/content/testimonials/${editing.id}`, { method: 'PUT', body: JSON.stringify(form) });
    else await adminFetch('/admin/content/testimonials', { method: 'POST', body: JSON.stringify(form) });
    setSaving(false); setEditing(null); setForm(empty); load();
  };
  const del = async (id: number) => {
    if (!confirm('Delete?')) return;
    await adminFetch(`/admin/content/testimonials/${id}`, { method: 'DELETE' }); load();
  };

  return (
    <AdminShell>
      <div className="p-6 max-w-4xl">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Testimonials</h1>
          <button onClick={() => { setEditing(null); setForm(empty); }} className="bg-blue-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-blue-700">+ Add</button>
        </div>

        {(editing !== null || form.author !== '') && (
          <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Author</label>
                <input className="w-full border rounded-lg px-3 py-2 text-sm" value={form.author}
                  onChange={(e) => setForm({ ...form, author: e.target.value })} />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Rating (1–5)</label>
                <input type="number" min={1} max={5} className="w-full border rounded-lg px-3 py-2 text-sm"
                  value={form.rating ?? ''}
                  onChange={(e) => setForm({ ...form, rating: e.target.value ? +e.target.value : null })} />
              </div>
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Quote</label>
              <textarea className="w-full border rounded-lg px-3 py-2 text-sm h-20 resize-none" value={form.quote}
                onChange={(e) => setForm({ ...form, quote: e.target.value })} />
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
              <button disabled={saving} onClick={save} className="bg-blue-600 text-white text-sm px-4 py-2 rounded-lg disabled:opacity-40">{saving ? 'Saving…' : 'Save'}</button>
              <button onClick={() => { setEditing(null); setForm(empty); }} className="text-sm px-4 py-2 rounded-lg border">Cancel</button>
            </div>
          </div>
        )}

        <div className="space-y-2">
          {items.map((t) => (
            <div key={t.id} className="bg-white rounded-xl border border-gray-100 p-4 flex items-start justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium text-sm text-gray-900">{t.author}</span>
                  {t.rating && <span className="text-yellow-500 text-xs">{'★'.repeat(t.rating)}</span>}
                  {!t.published && <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">Draft</span>}
                </div>
                <p className="text-xs text-gray-600 line-clamp-2 italic">"{t.quote}"</p>
              </div>
              <div className="flex gap-2 shrink-0">
                <button onClick={() => { setEditing(t); setForm({ author: t.author, quote: t.quote, rating: t.rating, position: t.position, published: t.published }); }} className="text-xs text-blue-600 hover:underline">Edit</button>
                <button onClick={() => del(t.id)} className="text-xs text-red-600 hover:underline">Delete</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </AdminShell>
  );
}
