'use client';
import { useEffect, useState } from 'react';
import AdminShell from '@/components/admin/AdminShell';
import { adminFetch } from '@/components/admin/useAdminAuth';

type FAQ = { id: number; question: string; answer: string; category: string | null; position: number; published: boolean };
type FAQForm = Omit<FAQ, 'id'>;
const empty: FAQForm = { question: '', answer: '', category: null, position: 0, published: true };

export default function FAQsPage() {
  const [faqs, setFaqs] = useState<FAQ[]>([]);
  const [editing, setEditing] = useState<FAQ | null>(null);
  const [form, setForm] = useState<FAQForm>(empty);
  const [saving, setSaving] = useState(false);

  const load = () =>
    adminFetch('/admin/content/faqs').then((r) => r.json()).then((d) => setFaqs(d.faqs));

  useEffect(() => { load(); }, []);

  const save = async () => {
    setSaving(true);
    if (editing) {
      await adminFetch(`/admin/content/faqs/${editing.id}`, { method: 'PUT', body: JSON.stringify(form) });
    } else {
      await adminFetch('/admin/content/faqs', { method: 'POST', body: JSON.stringify(form) });
    }
    setSaving(false);
    setEditing(null);
    setForm(empty);
    load();
  };

  const del = async (id: number) => {
    if (!confirm('Delete this FAQ?')) return;
    await adminFetch(`/admin/content/faqs/${id}`, { method: 'DELETE' });
    load();
  };

  return (
    <AdminShell>
      <div className="p-6 max-w-4xl">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-900">FAQs</h1>
          <button onClick={() => { setEditing(null); setForm(empty); }}
            className="bg-blue-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-blue-700">+ New FAQ</button>
        </div>

        {(editing !== null || form.question !== '') && (
          <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6 space-y-4">
            <h2 className="font-semibold text-gray-700">{editing ? 'Edit FAQ' : 'New FAQ'}</h2>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Question</label>
              <input className="w-full border rounded-lg px-3 py-2 text-sm" value={form.question}
                onChange={(e) => setForm({ ...form, question: e.target.value })} />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Answer</label>
              <textarea className="w-full border rounded-lg px-3 py-2 text-sm h-24 resize-none" value={form.answer}
                onChange={(e) => setForm({ ...form, answer: e.target.value })} />
            </div>
            <div className="flex gap-4">
              <div className="flex-1">
                <label className="text-xs text-gray-500 mb-1 block">Category</label>
                <input className="w-full border rounded-lg px-3 py-2 text-sm" value={form.category ?? ''}
                  onChange={(e) => setForm({ ...form, category: e.target.value || null })} />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Position</label>
                <input type="number" className="w-24 border rounded-lg px-3 py-2 text-sm" value={form.position}
                  onChange={(e) => setForm({ ...form, position: +e.target.value })} />
              </div>
              <div className="flex items-end pb-1">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={form.published}
                    onChange={(e) => setForm({ ...form, published: e.target.checked })} />
                  Published
                </label>
              </div>
            </div>
            <div className="flex gap-2">
              <button disabled={saving} onClick={save}
                className="bg-blue-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-40">
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button onClick={() => { setEditing(null); setForm(empty); }}
                className="text-sm px-4 py-2 rounded-lg border hover:bg-gray-50">Cancel</button>
            </div>
          </div>
        )}

        <div className="space-y-2">
          {faqs.map((f) => (
            <div key={f.id} className="bg-white rounded-xl border border-gray-100 p-4 flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  {!f.published && <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">Draft</span>}
                  {f.category && <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">{f.category}</span>}
                  <span className="text-xs text-gray-400">pos {f.position}</span>
                </div>
                <p className="text-sm font-medium text-gray-900">{f.question}</p>
                <p className="text-xs text-gray-500 mt-1 line-clamp-2">{f.answer}</p>
              </div>
              <div className="flex gap-2 shrink-0">
                <button onClick={() => { setEditing(f); setForm({ question: f.question, answer: f.answer, category: f.category, position: f.position, published: f.published }); }}
                  className="text-xs text-blue-600 hover:underline">Edit</button>
                <button onClick={() => del(f.id)} className="text-xs text-red-600 hover:underline">Delete</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </AdminShell>
  );
}
