'use client';
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { adminFetch } from '@/components/admin/useAdminAuth';
import {
  PageHeader, PageWrap, Card, Button, Input, Field,
  Pill, EmptyState, Checkbox,
} from '@/components/admin/ui';
import { LuMapPin } from 'react-icons/lu';

type Location = { id: number; name: string; address1: string | null; address2: string | null; city: string | null; state: string | null; postal_code: string | null; phone: string | null; is_telehealth: boolean; position: number };
type LocationForm = Omit<Location, 'id'>;
const empty: LocationForm = { name: '', address1: null, address2: null, city: null, state: null, postal_code: null, phone: null, is_telehealth: false, position: 0 };

export default function LocationsPage() {
  const [items, setItems] = useState<Location[]>([]);
  const [editing, setEditing] = useState<Location | null>(null);
  const [form, setForm] = useState<LocationForm>(empty);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = () => adminFetch('/admin/content/locations').then((r) => r.json()).then((d) => setItems(d.locations));
  useEffect(() => { load(); }, []);

  const startNew = () => { setEditing(null); setForm(empty); setOpen(true); };
  const startEdit = (loc: Location) => {
    setEditing(loc);
    setForm({ name: loc.name, address1: loc.address1, address2: loc.address2, city: loc.city, state: loc.state, postal_code: loc.postal_code, phone: loc.phone, is_telehealth: loc.is_telehealth, position: loc.position });
    setOpen(true);
  };
  const close = () => { setOpen(false); setEditing(null); setForm(empty); };

  const save = async () => {
    setSaving(true);
    if (editing) await adminFetch(`/admin/content/locations/${editing.id}`, { method: 'PUT', body: JSON.stringify(form) });
    else await adminFetch('/admin/content/locations', { method: 'POST', body: JSON.stringify(form) });
    setSaving(false);
    close();
    load();
  };
  const del = async (id: number) => {
    if (!confirm('Delete this location?')) return;
    await adminFetch(`/admin/content/locations/${id}`, { method: 'DELETE' });
    load();
  };

  return (
      <PageWrap max="max-w-4xl">
        <PageHeader
          title="Locations"
          subtitle="Physical office addresses and telehealth options."
          action={<Button onClick={startNew}>＋ Add location</Button>}
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
                <h2 className="mb-4 text-sm font-semibold text-slate-900">{editing ? 'Edit location' : 'New location'}</h2>
                <div className="space-y-4">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    {([['Name', 'name'], ['Address line 1', 'address1'], ['Address line 2', 'address2'], ['City', 'city'], ['State', 'state'], ['Zip', 'postal_code'], ['Phone', 'phone']] as const).map(([label, key]) => (
                      <Field key={key} label={label}>
                        <Input value={(form[key] as string) ?? ''} onChange={(e) => setForm({ ...form, [key]: e.target.value || null })} />
                      </Field>
                    ))}
                    <Field label="Position">
                      <Input type="number" value={form.position} onChange={(e) => setForm({ ...form, position: +e.target.value })} />
                    </Field>
                  </div>
                  <Checkbox label="Telehealth" checked={form.is_telehealth} onChange={(e) => setForm({ ...form, is_telehealth: e.target.checked })} />
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
            title="No locations yet"
            description="Add your first office or telehealth listing."
            action={<Button onClick={startNew}>＋ Add location</Button>}
            icon={<LuMapPin width={22} height={22} strokeWidth={1.8} />}
          />
        ) : (
          <motion.div initial="initial" animate="animate" variants={{ animate: { transition: { staggerChildren: 0.025 } } }} className="space-y-2">
            {items.map((loc) => (
              <motion.div
                key={loc.id}
                variants={{ initial: { opacity: 0, y: 4 }, animate: { opacity: 1, y: 0 } }}
                whileHover={{ y: -1 }}
                className="group flex items-center justify-between gap-4 rounded-2xl border border-slate-200/70 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-shadow hover:shadow-[0_8px_20px_rgba(15,23,42,0.05)]"
              >
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-50 to-cyan-50 text-indigo-600 ring-1 ring-inset ring-slate-200">
                    <LuMapPin width={18} height={18} strokeWidth={1.8} />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-slate-900">{loc.name}</span>
                      {loc.is_telehealth && <Pill tone="cyan">Telehealth</Pill>}
                    </div>
                    <div className="mt-0.5 text-xs text-slate-500">
                      {[loc.address1, loc.city, loc.state].filter(Boolean).join(', ') || <span className="text-slate-300">No address</span>}
                    </div>
                    {loc.phone && <div className="mt-0.5 font-mono text-[11px] text-slate-400">{loc.phone}</div>}
                  </div>
                </div>
                <div className="flex shrink-0 gap-1 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
                  <Button variant="ghost" size="sm" onClick={() => startEdit(loc)}>Edit</Button>
                  <Button variant="ghost" size="sm" onClick={() => del(loc.id)} className="!text-rose-600 hover:!bg-rose-50">Delete</Button>
                </div>
              </motion.div>
            ))}
          </motion.div>
        )}
      </PageWrap>
  );
}
