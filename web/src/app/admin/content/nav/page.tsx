'use client';
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { adminFetch } from '@/components/admin/useAdminAuth';
import {
  PageHeader, PageWrap, Card, Button, Input, Select, Field,
  Pill, EmptyState,
} from '@/components/admin/ui';

type NavItem = { id: number; parent_id: number | null; label: string; href: string; position: number; location: string };
type NavForm = Omit<NavItem, 'id'>;
const empty: NavForm = { parent_id: null, label: '', href: '', position: 0, location: 'header' };

export default function NavPage() {
  const [items, setItems] = useState<NavItem[]>([]);
  const [editing, setEditing] = useState<NavItem | null>(null);
  const [form, setForm] = useState<NavForm>(empty);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = () => adminFetch('/admin/content/nav').then((r) => r.json()).then((d) => setItems(d.nav_items));
  useEffect(() => { load(); }, []);

  const startNew = () => { setEditing(null); setForm(empty); setOpen(true); };
  const startEdit = (item: NavItem) => {
    setEditing(item);
    setForm({ parent_id: item.parent_id, label: item.label, href: item.href, position: item.position, location: item.location });
    setOpen(true);
  };
  const close = () => { setOpen(false); setEditing(null); setForm(empty); };

  const save = async () => {
    setSaving(true);
    if (editing) await adminFetch(`/admin/content/nav/${editing.id}`, { method: 'PUT', body: JSON.stringify(form) });
    else await adminFetch('/admin/content/nav', { method: 'POST', body: JSON.stringify(form) });
    setSaving(false);
    close();
    load();
  };
  const del = async (id: number) => {
    if (!confirm('Delete nav item?')) return;
    await adminFetch(`/admin/content/nav/${id}`, { method: 'DELETE' });
    load();
  };

  return (
      <PageWrap max="max-w-4xl">
        <PageHeader
          title="Navigation"
          subtitle="Header and footer navigation links across the public site."
          action={<Button onClick={startNew}>＋ Add item</Button>}
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
                <h2 className="mb-4 text-sm font-semibold text-slate-900">{editing ? 'Edit nav item' : 'New nav item'}</h2>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field label="Label">
                    <Input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
                  </Field>
                  <Field label="Href">
                    <Input value={form.href} onChange={(e) => setForm({ ...form, href: e.target.value })} className="font-mono" />
                  </Field>
                  <Field label="Location">
                    <Select value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })}>
                      <option value="header">Header</option>
                      <option value="footer">Footer</option>
                    </Select>
                  </Field>
                  <Field label="Parent">
                    <Select value={form.parent_id ?? ''} onChange={(e) => setForm({ ...form, parent_id: e.target.value ? +e.target.value : null })}>
                      <option value="">No parent</option>
                      {items.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
                    </Select>
                  </Field>
                  <Field label="Position">
                    <Input type="number" value={form.position} onChange={(e) => setForm({ ...form, position: +e.target.value })} />
                  </Field>
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
          <EmptyState title="No nav items yet" description="Add header or footer links." action={<Button onClick={startNew}>＋ Add item</Button>} />
        ) : (
          <div className="space-y-6">
            {(['header', 'footer'] as const).map((loc) => {
              const rows = items.filter((i) => i.location === loc);
              return (
                <div key={loc}>
                  <div className="mb-2 flex items-center gap-2 px-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500">
                    {loc}
                    <span className="rounded-full bg-slate-100 px-1.5 py-0 text-[10px] tabular-nums text-slate-500 ring-1 ring-inset ring-slate-200">
                      {rows.length}
                    </span>
                  </div>
                  {rows.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/40 px-4 py-6 text-center text-xs text-slate-400">
                      No {loc} items
                    </div>
                  ) : (
                    <motion.div initial="initial" animate="animate" variants={{ animate: { transition: { staggerChildren: 0.02 } } }} className="space-y-2">
                      {rows.map((item) => (
                        <motion.div
                          key={item.id}
                          variants={{ initial: { opacity: 0, y: 4 }, animate: { opacity: 1, y: 0 } }}
                          className="group flex items-center justify-between gap-3 rounded-xl border border-slate-200/70 bg-white px-4 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
                        >
                          <div className="flex min-w-0 items-center gap-2">
                            {item.parent_id && <span className="shrink-0 text-slate-300">↳</span>}
                            <span className="shrink-0 text-sm font-medium text-slate-900">{item.label}</span>
                            <span className="truncate font-mono text-[11px] text-slate-400">{item.href}</span>
                            {item.parent_id && <Pill tone="slate">child</Pill>}
                          </div>
                          <div className="flex shrink-0 gap-1 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
                            <Button variant="ghost" size="sm" onClick={() => startEdit(item)}>Edit</Button>
                            <Button variant="ghost" size="sm" onClick={() => del(item.id)} className="!text-rose-600 hover:!bg-rose-50">Delete</Button>
                          </div>
                        </motion.div>
                      ))}
                    </motion.div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </PageWrap>
  );
}
