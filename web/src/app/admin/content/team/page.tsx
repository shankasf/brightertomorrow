'use client';
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { adminFetch } from '@/components/admin/useAdminAuth';
import {
  PageHeader, PageWrap, Card, Button, Input, Textarea, Select, Field,
  Pill, EmptyState, Checkbox,
} from '@/components/admin/ui';
import { LuUser } from 'react-icons/lu';

type Group = { id: number; slug: string; title: string; description: string | null; position: number };
type Member = {
  id: number; group_id: number | null; full_name: string; credentials: string | null;
  role: string | null; bio: string | null; photo_url: string | null; email: string | null;
  accepts_new: boolean; position: number; published: boolean;
  office_locations: string[]; pricing_tier: string | null;
  network_status: string | null; specialties: string[];
};
type MemberForm = Omit<Member, 'id'>;

const OFFICE_OPTIONS = [
  { slug: 'e-russell', label: 'E Russell' },
  { slug: 'n-durango', label: 'N Durango' },
  { slug: 'telehealth', label: 'Telehealth' },
];

const emptyMember: MemberForm = {
  group_id: null, full_name: '', credentials: null, role: null, bio: null,
  photo_url: null, email: null, accepts_new: true, position: 0, published: true,
  office_locations: [], pricing_tier: null, network_status: null, specialties: [],
};

export default function TeamPage() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [editing, setEditing] = useState<Member | null>(null);
  const [form, setForm] = useState<MemberForm>(emptyMember);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [viewing, setViewing] = useState<Member | null>(null);

  // Local text state for comma-separated specialties input
  const [specialtiesText, setSpecialtiesText] = useState('');

  const load = async () => {
    const [g, m] = await Promise.all([
      adminFetch('/admin/content/team/groups').then((r) => r.json()),
      adminFetch('/admin/content/team/members').then((r) => r.json()),
    ]);
    setGroups(g.groups);
    setMembers(m.members);
  };
  useEffect(() => { load(); }, []);

  const startNew = () => {
    setEditing(null);
    setForm(emptyMember);
    setSpecialtiesText('');
    setOpen(true);
  };
  const startEdit = (m: Member) => {
    setEditing(m);
    setForm({
      group_id: m.group_id, full_name: m.full_name, credentials: m.credentials, role: m.role,
      bio: m.bio, photo_url: m.photo_url, email: m.email, accepts_new: m.accepts_new,
      position: m.position, published: m.published,
      office_locations: m.office_locations ?? [],
      pricing_tier: m.pricing_tier,
      network_status: m.network_status,
      specialties: m.specialties ?? [],
    });
    setSpecialtiesText((m.specialties ?? []).join(', '));
    setOpen(true);
  };
  const close = () => { setOpen(false); setEditing(null); setForm(emptyMember); setSpecialtiesText(''); };

  const toggleOffice = (slug: string) => {
    setForm((f) => {
      const locs = f.office_locations ?? [];
      return {
        ...f,
        office_locations: locs.includes(slug)
          ? locs.filter((s) => s !== slug)
          : [...locs, slug],
      };
    });
  };

  const save = async () => {
    setSaving(true);
    // Parse specialties from the text field before saving
    const parsed = specialtiesText
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const payload = { ...form, specialties: parsed };
    if (editing) {
      await adminFetch(`/admin/content/team/members/${editing.id}`, { method: 'PUT', body: JSON.stringify(payload) });
    } else {
      await adminFetch('/admin/content/team/members', { method: 'POST', body: JSON.stringify(payload) });
    }
    setSaving(false);
    close();
    load();
  };

  const del = async (id: number) => {
    if (!confirm('Delete this team member?')) return;
    await adminFetch(`/admin/content/team/members/${id}`, { method: 'DELETE' });
    load();
  };

  const groupName = (id: number | null) => groups.find((g) => g.id === id)?.title ?? '—';

  return (
      <PageWrap max="max-w-5xl">
        <PageHeader
          title="Team members"
          subtitle="Therapists and staff displayed on the public team page."
          action={<Button onClick={startNew}>＋ Add member</Button>}
        />

        <AnimatePresence>
          {open && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 backdrop-blur-sm sm:items-center"
              onClick={close}
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.97, y: 8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.97, y: 8 }}
                transition={{ duration: 0.18 }}
                onClick={(e) => e.stopPropagation()}
                className="my-8 w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200"
              >
                <div className="flex items-start justify-between gap-4 border-b border-slate-100 bg-gradient-to-br from-indigo-50/50 via-white to-white p-5">
                  <h2 className="text-base font-semibold text-slate-900">{editing ? 'Edit member' : 'New member'}</h2>
                  <button onClick={close} className="shrink-0 rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700" aria-label="Close">✕</button>
                </div>
                <div className="space-y-4 p-5">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Field label="Full name">
                      <Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
                    </Field>
                    <Field label="Group">
                      <Select value={form.group_id ?? ''} onChange={(e) => setForm({ ...form, group_id: e.target.value ? +e.target.value : null })}>
                        <option value="">No group</option>
                        {groups.map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}
                      </Select>
                    </Field>
                    <Field label="Credentials">
                      <Input value={form.credentials ?? ''} onChange={(e) => setForm({ ...form, credentials: e.target.value || null })} />
                    </Field>
                    <Field label="Role">
                      <Input value={form.role ?? ''} onChange={(e) => setForm({ ...form, role: e.target.value || null })} />
                    </Field>
                    <Field label="Email">
                      <Input type="email" value={form.email ?? ''} onChange={(e) => setForm({ ...form, email: e.target.value || null })} />
                    </Field>
                    <Field label="Photo URL">
                      <Input value={form.photo_url ?? ''} onChange={(e) => setForm({ ...form, photo_url: e.target.value || null })} />
                    </Field>
                  </div>

                  <Field label="Bio">
                    <Textarea rows={4} value={form.bio ?? ''} onChange={(e) => setForm({ ...form, bio: e.target.value || null })} />
                  </Field>

                  {/* Office locations — multi-select checkboxes */}
                  <Field label="Office locations">
                    <div className="flex flex-wrap gap-3 pt-1">
                      {OFFICE_OPTIONS.map(({ slug, label }) => (
                        <Checkbox
                          key={slug}
                          label={label}
                          checked={(form.office_locations ?? []).includes(slug)}
                          onChange={() => toggleOffice(slug)}
                        />
                      ))}
                    </div>
                  </Field>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Field label="Pricing tier" hint="e.g. $125–$150 / session">
                      <Input
                        value={form.pricing_tier ?? ''}
                        onChange={(e) => setForm({ ...form, pricing_tier: e.target.value || null })}
                        placeholder="$25–$60 / session"
                      />
                    </Field>
                    <Field label="Network status" hint="e.g. In-Network: Aetna, Cigna, BCBS, UHC">
                      <Input
                        value={form.network_status ?? ''}
                        onChange={(e) => setForm({ ...form, network_status: e.target.value || null })}
                        placeholder="Sliding Scale Available"
                      />
                    </Field>
                  </div>

                  <Field label="Specialties" hint="Comma-separated, e.g. Anxiety, Trauma, LGBTQIA+">
                    <Input
                      value={specialtiesText}
                      onChange={(e) => setSpecialtiesText(e.target.value)}
                      placeholder="Anxiety, Trauma, Couples"
                    />
                  </Field>

                  <div className="flex flex-wrap items-end gap-6">
                    <Field label="Position">
                      <Input type="number" value={form.position} onChange={(e) => setForm({ ...form, position: +e.target.value })} className="!w-24" />
                    </Field>
                    <div className="flex flex-wrap items-center gap-5 pb-2">
                      <Checkbox label="Accepts new clients" checked={form.accepts_new} onChange={(e) => setForm({ ...form, accepts_new: e.target.checked })} />
                      <Checkbox label="Published" checked={form.published} onChange={(e) => setForm({ ...form, published: e.target.checked })} />
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 border-t border-slate-100 bg-slate-50/60 p-4">
                  <Button onClick={save} loading={saving}>{saving ? "Saving…" : "Save"}</Button>
                  <Button variant="secondary" onClick={close} className="ml-auto">Cancel</Button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {members.length === 0 ? (
          <EmptyState
            title="No team members yet"
            description="Add your first staff profile."
            action={<Button onClick={startNew}>＋ Add member</Button>}
            icon={<LuUser width={22} height={22} strokeWidth={1.8} />}
          />
        ) : (
          <motion.div initial="initial" animate="animate" variants={{ animate: { transition: { staggerChildren: 0.03 } } }} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {members.map((m) => (
              <motion.div
                key={m.id}
                variants={{ initial: { opacity: 0, y: 4 }, animate: { opacity: 1, y: 0 } }}
                whileHover={{ y: -2 }}
                onClick={() => setViewing(m)}
                className="group flex cursor-pointer items-start gap-3 rounded-2xl border border-slate-200/70 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-shadow hover:shadow-[0_8px_20px_rgba(15,23,42,0.06)]"
              >
                {m.photo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={m.photo_url} alt="" className="h-14 w-14 shrink-0 rounded-full object-cover ring-2 ring-white ring-offset-2 ring-offset-slate-100" />
                ) : (
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-cyan-500 text-base font-semibold text-white">
                    {m.full_name[0]?.toUpperCase() ?? '?'}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900">{m.full_name}</p>
                      {m.credentials && <span className="text-xs text-slate-500">{m.credentials}</span>}
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); startEdit(m); }}>Edit</Button>
                      <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); del(m.id); }} className="!text-rose-600 hover:!bg-rose-50">Delete</Button>
                    </div>
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500">{m.role ?? '—'} · {groupName(m.group_id)}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {!m.published && <Pill tone="slate">Draft</Pill>}
                    {m.accepts_new ? <Pill tone="green" dot>Accepting</Pill> : <Pill tone="amber">Waitlist</Pill>}
                    {(m.office_locations ?? []).map((s) => (
                      <Pill key={s} tone="slate">{s}</Pill>
                    ))}
                  </div>
                </div>
              </motion.div>
            ))}
          </motion.div>
        )}

        <AnimatePresence>
          {viewing && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 backdrop-blur-sm sm:items-center"
              onClick={() => setViewing(null)}
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.97, y: 8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.97, y: 8 }}
                transition={{ duration: 0.18 }}
                onClick={(e) => e.stopPropagation()}
                className="my-8 w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200"
              >
                <div className="flex items-start gap-4 border-b border-slate-100 bg-gradient-to-br from-indigo-50/50 via-white to-white p-5">
                  {viewing.photo_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={viewing.photo_url} alt="" className="h-16 w-16 shrink-0 rounded-full object-cover ring-2 ring-white ring-offset-2 ring-offset-slate-100" />
                  ) : (
                    <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-cyan-500 text-lg font-semibold text-white">
                      {viewing.full_name[0]?.toUpperCase() ?? '?'}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <h2 className="text-base font-semibold text-slate-900">{viewing.full_name}</h2>
                    {viewing.credentials && <p className="text-sm text-slate-500">{viewing.credentials}</p>}
                    <p className="mt-0.5 text-xs text-slate-500">{viewing.role ?? '—'} · {groupName(viewing.group_id)}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {!viewing.published && <Pill tone="slate">Draft</Pill>}
                      {viewing.accepts_new ? <Pill tone="green" dot>Accepting</Pill> : <Pill tone="amber">Waitlist</Pill>}
                    </div>
                  </div>
                  <button onClick={() => setViewing(null)} className="shrink-0 rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700" aria-label="Close">✕</button>
                </div>

                <div className="space-y-4 p-5">
                  <DetailRow label="Email" value={viewing.email} />
                  <DetailRow label="Bio" value={viewing.bio} />
                  <DetailRow label="Office locations" value={(viewing.office_locations ?? []).join(', ') || null} />
                  <DetailRow label="Pricing tier" value={viewing.pricing_tier} />
                  <DetailRow label="Network status" value={viewing.network_status} />
                  <DetailRow label="Specialties" value={(viewing.specialties ?? []).join(', ') || null} />
                  <DetailRow label="Photo URL" value={viewing.photo_url} />
                  <DetailRow label="Position" value={String(viewing.position)} />
                </div>

                <div className="flex items-center gap-2 border-t border-slate-100 bg-slate-50/60 p-4">
                  <Button onClick={() => { const m = viewing; setViewing(null); startEdit(m); }}>Edit</Button>
                  <Button variant="danger" onClick={() => { const id = viewing.id; setViewing(null); del(id); }}>Delete</Button>
                  <Button variant="secondary" onClick={() => setViewing(null)} className="ml-auto">Close</Button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </PageWrap>
  );
}

function DetailRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="grid grid-cols-3 gap-3">
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="col-span-2 whitespace-pre-wrap break-words text-sm text-slate-700">{value || <span className="text-slate-300">—</span>}</dd>
    </div>
  );
}
