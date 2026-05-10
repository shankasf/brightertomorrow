'use client';
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { adminFetch } from '@/components/admin/useAdminAuth';
import {
  PageHeader, PageWrap, Card, Button, Input, Textarea, Field,
  Pill, EmptyState, Checkbox,
} from '@/components/admin/ui';

type Testimonial = { id: number; author: string; quote: string; rating: number | null; position: number; published: boolean };
type TestimonialForm = Omit<Testimonial, 'id'>;
const empty: TestimonialForm = { author: '', quote: '', rating: null, position: 0, published: true };

function Stars({ n, max = 5 }: { n: number; max?: number }) {
  return (
    <span className="inline-flex items-center gap-0.5">
      {Array.from({ length: max }).map((_, i) => (
        <svg key={i} width="12" height="12" viewBox="0 0 24 24" className={i < n ? 'fill-amber-400 text-amber-400' : 'fill-slate-200 text-slate-200'}>
          <polygon points="12 2 15.1 8.5 22 9.3 17 14.1 18.2 21 12 17.8 5.8 21 7 14.1 2 9.3 8.9 8.5 12 2" />
        </svg>
      ))}
    </span>
  );
}

export default function TestimonialsPage() {
  const [items, setItems] = useState<Testimonial[]>([]);
  const [editing, setEditing] = useState<Testimonial | null>(null);
  const [form, setForm] = useState<TestimonialForm>(empty);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = () => adminFetch('/admin/content/testimonials').then((r) => r.json()).then((d) => setItems(d.testimonials));
  useEffect(() => { load(); }, []);

  const startNew = () => { setEditing(null); setForm(empty); setOpen(true); };
  const startEdit = (t: Testimonial) => {
    setEditing(t);
    setForm({ author: t.author, quote: t.quote, rating: t.rating, position: t.position, published: t.published });
    setOpen(true);
  };
  const close = () => { setOpen(false); setEditing(null); setForm(empty); };

  const save = async () => {
    setSaving(true);
    if (editing) await adminFetch(`/admin/content/testimonials/${editing.id}`, { method: 'PUT', body: JSON.stringify(form) });
    else await adminFetch('/admin/content/testimonials', { method: 'POST', body: JSON.stringify(form) });
    setSaving(false);
    close();
    load();
  };
  const del = async (id: number) => {
    if (!confirm('Delete this testimonial?')) return;
    await adminFetch(`/admin/content/testimonials/${id}`, { method: 'DELETE' });
    load();
  };

  return (
      <PageWrap max="max-w-4xl">
        <PageHeader
          title="Testimonials"
          subtitle="Client quotes shown on the public site."
          action={<Button onClick={startNew}>＋ Add testimonial</Button>}
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
                <h2 className="mb-4 text-sm font-semibold text-slate-900">{editing ? 'Edit testimonial' : 'New testimonial'}</h2>
                <div className="space-y-4">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Field label="Author">
                      <Input value={form.author} onChange={(e) => setForm({ ...form, author: e.target.value })} />
                    </Field>
                    <Field label="Rating (1–5)">
                      <Input type="number" min={1} max={5} value={form.rating ?? ''} onChange={(e) => setForm({ ...form, rating: e.target.value ? +e.target.value : null })} />
                    </Field>
                  </div>
                  <Field label="Quote">
                    <Textarea rows={3} value={form.quote} onChange={(e) => setForm({ ...form, quote: e.target.value })} />
                  </Field>
                  <div className="flex flex-wrap items-end gap-6">
                    <Field label="Position">
                      <Input type="number" value={form.position} onChange={(e) => setForm({ ...form, position: +e.target.value })} className="!w-24" />
                    </Field>
                    <Checkbox label="Published" checked={form.published} onChange={(e) => setForm({ ...form, published: e.target.checked })} />
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

        {items.length === 0 ? (
          <EmptyState
            title="No testimonials yet"
            description="Add a client quote to display on the public site."
            action={<Button onClick={startNew}>＋ Add testimonial</Button>}
            icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.76-2.02-2-2H4c-1.24 0-2 .77-2 2v8c0 1.24.76 2 2 2h2c0 4-3 5-3 5zM15 21c3 0 7-1 7-8V5c0-1.25-.76-2.02-2-2h-4c-1.24 0-2 .77-2 2v8c0 1.24.76 2 2 2h2c0 4-3 5-3 5z" /></svg>}
          />
        ) : (
          <motion.div initial="initial" animate="animate" variants={{ animate: { transition: { staggerChildren: 0.03 } } }} className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {items.map((t) => (
              <motion.div
                key={t.id}
                variants={{ initial: { opacity: 0, y: 4 }, animate: { opacity: 1, y: 0 } }}
                whileHover={{ y: -2 }}
                className="group relative overflow-hidden rounded-2xl border border-slate-200/70 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-shadow hover:shadow-[0_8px_20px_rgba(15,23,42,0.05)]"
              >
                <svg className="absolute right-3 top-3 h-8 w-8 text-slate-100" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M3 21c3 0 7-1 7-8V5c0-1.25-.76-2.02-2-2H4c-1.24 0-2 .77-2 2v8c0 1.24.76 2 2 2h2c0 4-3 5-3 5zM15 21c3 0 7-1 7-8V5c0-1.25-.76-2.02-2-2h-4c-1.24 0-2 .77-2 2v8c0 1.24.76 2 2 2h2c0 4-3 5-3 5z" />
                </svg>
                <div className="relative">
                  <p className="text-sm leading-relaxed text-slate-700">"{t.quote}"</p>
                  <div className="mt-4 flex items-center justify-between gap-2">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">{t.author}</div>
                      <div className="mt-0.5 flex items-center gap-2">
                        {t.rating && <Stars n={t.rating} />}
                        {!t.published && <Pill tone="slate">Draft</Pill>}
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                      <Button variant="ghost" size="sm" onClick={() => startEdit(t)}>Edit</Button>
                      <Button variant="ghost" size="sm" onClick={() => del(t.id)} className="!text-rose-600 hover:!bg-rose-50">Delete</Button>
                    </div>
                  </div>
                </div>
              </motion.div>
            ))}
          </motion.div>
        )}
      </PageWrap>
  );
}
