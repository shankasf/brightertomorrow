'use client';
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { adminFetch } from '@/components/admin/useAdminAuth';
import { PageHeader, PageWrap, Card, Button, Input } from '@/components/admin/ui';

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
      <PageWrap max="max-w-3xl">
        <PageHeader
          title="Homepage stats"
          subtitle="Counter cards displayed on the homepage. Click a stat to edit in place."
        />

        <motion.div initial="initial" animate="animate" variants={{ animate: { transition: { staggerChildren: 0.03 } } }} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {stats.map((s) => (
            <motion.div key={s.id} variants={{ initial: { opacity: 0, y: 4 }, animate: { opacity: 1, y: 0 } }}>
              <Card className="overflow-hidden">
                <AnimatePresence mode="wait">
                  {editing === s.id ? (
                    <motion.div
                      key="edit"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="space-y-3"
                    >
                      <div className="grid grid-cols-3 gap-2">
                        <Input
                          className="col-span-2"
                          value={forms[s.id]?.label ?? ''}
                          onChange={(e) => setForms((f) => ({ ...f, [s.id]: { ...f[s.id], label: e.target.value } }))}
                          placeholder="Label"
                        />
                        <Input
                          value={forms[s.id]?.value ?? ''}
                          onChange={(e) => setForms((f) => ({ ...f, [s.id]: { ...f[s.id], value: e.target.value } }))}
                          placeholder="Value"
                        />
                        <Input
                          className="col-span-3"
                          value={forms[s.id]?.suffix ?? ''}
                          onChange={(e) => setForms((f) => ({ ...f, [s.id]: { ...f[s.id], suffix: e.target.value || null } }))}
                          placeholder="Suffix (e.g. +, %)"
                        />
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => save(s.id)} disabled={saving === s.id}>{saving === s.id ? 'Saving…' : 'Save'}</Button>
                        <Button size="sm" variant="secondary" onClick={() => setEditing(null)}>Cancel</Button>
                      </div>
                    </motion.div>
                  ) : (
                    <motion.div
                      key="view"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="group flex items-center justify-between"
                    >
                      <div>
                        <div className="text-3xl font-semibold tracking-tight tabular-nums text-slate-900">
                          {s.value}
                          <span className="ml-0.5 text-xl font-medium text-indigo-500">{s.suffix}</span>
                        </div>
                        <div className="mt-1 text-xs font-medium uppercase tracking-wider text-slate-500">{s.label}</div>
                      </div>
                      <Button variant="ghost" size="sm" onClick={() => setEditing(s.id)} className="transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
                        Edit
                      </Button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </Card>
            </motion.div>
          ))}
        </motion.div>
      </PageWrap>
  );
}
