'use client';
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { adminFetch } from '@/components/admin/useAdminAuth';
import {
  PageHeader, PageWrap, Card, Button, Input, Textarea, Field,
  Pill, EmptyState, Checkbox,
} from '@/components/admin/ui';
import { LuStethoscope } from 'react-icons/lu';

type Service = { id: number; slug: string; title: string; short_desc: string | null; long_desc: string | null; image_url: string | null; icon: string | null; position: number; published: boolean };
type ServiceForm = Omit<Service, 'id'>;
const empty: ServiceForm = { slug: '', title: '', short_desc: null, long_desc: null, image_url: null, icon: null, position: 0, published: true };

export default function ServicesPage() {
  const [items, setItems] = useState<Service[]>([]);
  const [editing, setEditing] = useState<Service | null>(null);
  const [form, setForm] = useState<ServiceForm>(empty);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = () => adminFetch('/admin/content/services').then((r) => r.json()).then((d) => setItems(d.services));
  useEffect(() => { load(); }, []);

  const startNew = () => { setEditing(null); setForm(empty); setOpen(true); };
  const startEdit = (s: Service) => {
    setEditing(s);
    setForm({ slug: s.slug, title: s.title, short_desc: s.short_desc, long_desc: s.long_desc, image_url: s.image_url, icon: s.icon, position: s.position, published: s.published });
    setOpen(true);
  };
  const close = () => { setOpen(false); setEditing(null); setForm(empty); };

  const save = async () => {
    setSaving(true);
    if (editing) await adminFetch(`/admin/content/services/${editing.id}`, { method: 'PUT', body: JSON.stringify(form) });
    else await adminFetch('/admin/content/services', { method: 'POST', body: JSON.stringify(form) });
    setSaving(false);
    close();
    load();
  };
  const del = async (id: number) => {
    if (!confirm('Delete this service?')) return;
    await adminFetch(`/admin/content/services/${id}`, { method: 'DELETE' });
    load();
  };

  return (
      <PageWrap max="max-w-4xl">
        <PageHeader
          title="Services"
          subtitle="Treatment services listed on the public services page."
          action={<Button onClick={startNew}>＋ New service</Button>}
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
                <h2 className="mb-4 text-sm font-semibold text-slate-900">{editing ? 'Edit service' : 'New service'}</h2>
                <div className="space-y-4">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    {([['Title', 'title'], ['Slug', 'slug'], ['Icon', 'icon'], ['Image URL', 'image_url']] as const).map(([label, key]) => (
                      <Field key={key} label={label}>
                        <Input
                          value={(form[key] as string) ?? ''}
                          onChange={(e) => setForm({ ...form, [key]: e.target.value || null })}
                          className={key === 'slug' ? 'font-mono' : ''}
                        />
                      </Field>
                    ))}
                  </div>
                  <Field label="Short description">
                    <Textarea rows={2} value={form.short_desc ?? ''} onChange={(e) => setForm({ ...form, short_desc: e.target.value || null })} />
                  </Field>
                  <Field label="Long description">
                    <Textarea rows={5} value={form.long_desc ?? ''} onChange={(e) => setForm({ ...form, long_desc: e.target.value || null })} />
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
            title="No services yet"
            description="Add your first service to populate the services page."
            action={<Button onClick={startNew}>＋ New service</Button>}
            icon={<LuStethoscope width={22} height={22} strokeWidth={1.8} />}
          />
        ) : (
          <motion.div initial="initial" animate="animate" variants={{ animate: { transition: { staggerChildren: 0.025 } } }} className="space-y-2">
            {items.map((s) => (
              <motion.div
                key={s.id}
                variants={{ initial: { opacity: 0, y: 4 }, animate: { opacity: 1, y: 0 } }}
                whileHover={{ y: -1 }}
                className="group flex items-center justify-between gap-4 rounded-2xl border border-slate-200/70 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-shadow hover:shadow-[0_8px_20px_rgba(15,23,42,0.05)]"
              >
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-50 to-cyan-50 text-lg ring-1 ring-inset ring-slate-200">
                    {s.icon || '✦'}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-slate-900">{s.title}</span>
                      {!s.published && <Pill tone="slate">Draft</Pill>}
                    </div>
                    <div className="mt-0.5 font-mono text-[11px] text-slate-400">/{s.slug}</div>
                    {s.short_desc && <div className="mt-1 line-clamp-1 text-xs text-slate-500">{s.short_desc}</div>}
                  </div>
                </div>
                <div className="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                  <Button variant="ghost" size="sm" onClick={() => startEdit(s)}>Edit</Button>
                  <Button variant="ghost" size="sm" onClick={() => del(s.id)} className="!text-rose-600 hover:!bg-rose-50">Delete</Button>
                </div>
              </motion.div>
            ))}
          </motion.div>
        )}
      </PageWrap>
  );
}
