'use client';
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { adminFetch } from '@/components/admin/useAdminAuth';
import {
  PageHeader, PageWrap, Card, Button, Input, Textarea, Field,
  Pill, EmptyState, Checkbox,
} from '@/components/admin/ui';
import { LuCircleHelp } from 'react-icons/lu';

type FAQ = { id: number; question: string; answer: string; category: string | null; position: number; published: boolean };
type FAQForm = Omit<FAQ, 'id'>;
const empty: FAQForm = { question: '', answer: '', category: null, position: 0, published: true };

export default function FAQsPage() {
  const [faqs, setFaqs] = useState<FAQ[]>([]);
  const [editing, setEditing] = useState<FAQ | null>(null);
  const [form, setForm] = useState<FAQForm>(empty);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = () => adminFetch('/admin/content/faqs').then((r) => r.json()).then((d) => setFaqs(d.faqs));
  useEffect(() => { load(); }, []);

  const startNew = () => { setEditing(null); setForm(empty); setOpen(true); };
  const startEdit = (f: FAQ) => {
    setEditing(f);
    setForm({ question: f.question, answer: f.answer, category: f.category, position: f.position, published: f.published });
    setOpen(true);
  };
  const close = () => { setOpen(false); setEditing(null); setForm(empty); };

  const save = async () => {
    setSaving(true);
    if (editing) await adminFetch(`/admin/content/faqs/${editing.id}`, { method: 'PUT', body: JSON.stringify(form) });
    else await adminFetch('/admin/content/faqs', { method: 'POST', body: JSON.stringify(form) });
    setSaving(false);
    close();
    load();
  };

  const del = async (id: number) => {
    if (!confirm('Delete this FAQ?')) return;
    await adminFetch(`/admin/content/faqs/${id}`, { method: 'DELETE' });
    load();
  };

  return (
      <PageWrap max="max-w-4xl">
        <PageHeader
          title="FAQs"
          subtitle="Frequently asked questions shown on the public site."
          action={<Button onClick={startNew}>＋ New FAQ</Button>}
        />

        <AnimatePresence>
          {open && (
            <motion.div
              initial={{ opacity: 0, y: -6, height: 0 }}
              animate={{ opacity: 1, y: 0, height: 'auto' }}
              exit={{ opacity: 0, y: -6, height: 0 }}
              transition={{ duration: 0.22 }}
              className="mb-6 overflow-hidden"
            >
              <Card className="border-indigo-200/70 bg-gradient-to-br from-indigo-50/40 via-white to-white">
                <h2 className="mb-4 text-sm font-semibold text-slate-900">{editing ? 'Edit FAQ' : 'New FAQ'}</h2>
                <div className="space-y-4">
                  <Field label="Question">
                    <Input value={form.question} onChange={(e) => setForm({ ...form, question: e.target.value })} placeholder="What time are appointments?" />
                  </Field>
                  <Field label="Answer">
                    <Textarea rows={4} value={form.answer} onChange={(e) => setForm({ ...form, answer: e.target.value })} />
                  </Field>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <Field label="Category">
                      <Input value={form.category ?? ''} onChange={(e) => setForm({ ...form, category: e.target.value || null })} placeholder="General" />
                    </Field>
                    <Field label="Position">
                      <Input type="number" value={form.position} onChange={(e) => setForm({ ...form, position: +e.target.value })} />
                    </Field>
                    <div className="flex items-end pb-2">
                      <Checkbox label="Published" checked={form.published} onChange={(e) => setForm({ ...form, published: e.target.checked })} />
                    </div>
                  </div>
                </div>
                <div className="mt-5 flex items-center gap-2">
                  <Button onClick={save} loading={saving}>{saving ? "Saving…" : "Save"}</Button>
                  <Button variant="secondary" onClick={close}>Cancel</Button>
                </div>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>

        {faqs.length === 0 ? (
          <EmptyState
            title="No FAQs yet"
            description="Add your first FAQ to start populating the help section."
            action={<Button onClick={startNew}>＋ New FAQ</Button>}
            icon={<LuCircleHelp width={22} height={22} strokeWidth={1.8} />}
          />
        ) : (
          <motion.div initial="initial" animate="animate" variants={{ animate: { transition: { staggerChildren: 0.025 } } }} className="space-y-2">
            {faqs.map((f) => (
              <motion.div
                key={f.id}
                variants={{ initial: { opacity: 0, y: 4 }, animate: { opacity: 1, y: 0 } }}
                whileHover={{ y: -1 }}
                className="group flex items-start justify-between gap-4 rounded-2xl border border-slate-200/70 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-shadow hover:shadow-[0_8px_20px_rgba(15,23,42,0.05)]"
              >
                <div className="min-w-0 flex-1">
                  <div className="mb-1.5 flex flex-wrap items-center gap-2">
                    {!f.published && <Pill tone="slate">Draft</Pill>}
                    {f.category && <Pill tone="blue">{f.category}</Pill>}
                    <span className="font-mono text-[10px] tabular-nums text-slate-400">pos {f.position}</span>
                  </div>
                  <p className="text-sm font-semibold text-slate-900">{f.question}</p>
                  <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-slate-500">{f.answer}</p>
                </div>
                <div className="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                  <Button variant="ghost" size="sm" onClick={() => startEdit(f)}>Edit</Button>
                  <Button variant="ghost" size="sm" onClick={() => del(f.id)} className="!text-rose-600 hover:!bg-rose-50">Delete</Button>
                </div>
              </motion.div>
            ))}
          </motion.div>
        )}
      </PageWrap>
  );
}
