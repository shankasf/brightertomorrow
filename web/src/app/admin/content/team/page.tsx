'use client';
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { adminFetch } from '@/components/admin/useAdminAuth';
import {
  PageHeader, PageWrap, Card, Button, Input, Textarea, Select, Field,
  Pill, EmptyState, Checkbox,
} from '@/components/admin/ui';

type Group = { id: number; slug: string; title: string; description: string | null; position: number };
type Member = {
  id: number; group_id: number | null; full_name: string; credentials: string | null;
  role: string | null; bio: string | null; photo_url: string | null; email: string | null;
  accepts_new: boolean; position: number; published: boolean;
};
type MemberForm = Omit<Member, 'id'>;
const emptyMember: MemberForm = {
  group_id: null, full_name: '', credentials: null, role: null, bio: null,
  photo_url: null, email: null, accepts_new: true, position: 0, published: true,
};

export default function TeamPage() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [editing, setEditing] = useState<Member | null>(null);
  const [form, setForm] = useState<MemberForm>(emptyMember);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const [g, m] = await Promise.all([
      adminFetch('/admin/content/team/groups').then((r) => r.json()),
      adminFetch('/admin/content/team/members').then((r) => r.json()),
    ]);
    setGroups(g.groups);
    setMembers(m.members);
  };
  useEffect(() => { load(); }, []);

  const startNew = () => { setEditing(null); setForm(emptyMember); setOpen(true); };
  const startEdit = (m: Member) => {
    setEditing(m);
    setForm({
      group_id: m.group_id, full_name: m.full_name, credentials: m.credentials, role: m.role,
      bio: m.bio, photo_url: m.photo_url, email: m.email, accepts_new: m.accepts_new,
      position: m.position, published: m.published,
    });
    setOpen(true);
  };
  const close = () => { setOpen(false); setEditing(null); setForm(emptyMember); };

  const save = async () => {
    setSaving(true);
    if (editing) await adminFetch(`/admin/content/team/members/${editing.id}`, { method: 'PUT', body: JSON.stringify(form) });
    else await adminFetch('/admin/content/team/members', { method: 'POST', body: JSON.stringify(form) });
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
              initial={{ opacity: 0, y: -6, height: 0 }}
              animate={{ opacity: 1, y: 0, height: 'auto' }}
              exit={{ opacity: 0, y: -6, height: 0 }}
              transition={{ duration: 0.22 }}
              className="mb-6 overflow-hidden"
            >
              <Card className="border-indigo-200/70 bg-gradient-to-br from-indigo-50/40 via-white to-white">
                <h2 className="mb-4 text-sm font-semibold text-slate-900">{editing ? 'Edit member' : 'New member'}</h2>
                <div className="space-y-4">
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
                <div className="mt-5 flex items-center gap-2">
                  <Button onClick={save} loading={saving}>{saving ? "Saving…" : "Save"}</Button>
                  <Button variant="secondary" onClick={close}>Cancel</Button>
                </div>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>

        {members.length === 0 ? (
          <EmptyState
            title="No team members yet"
            description="Add your first staff profile."
            action={<Button onClick={startNew}>＋ Add member</Button>}
            icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg>}
          />
        ) : (
          <motion.div initial="initial" animate="animate" variants={{ animate: { transition: { staggerChildren: 0.03 } } }} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {members.map((m) => (
              <motion.div
                key={m.id}
                variants={{ initial: { opacity: 0, y: 4 }, animate: { opacity: 1, y: 0 } }}
                whileHover={{ y: -2 }}
                className="group flex items-start gap-3 rounded-2xl border border-slate-200/70 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-shadow hover:shadow-[0_8px_20px_rgba(15,23,42,0.06)]"
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
                    <div className="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                      <Button variant="ghost" size="sm" onClick={() => startEdit(m)}>Edit</Button>
                      <Button variant="ghost" size="sm" onClick={() => del(m.id)} className="!text-rose-600 hover:!bg-rose-50">Delete</Button>
                    </div>
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500">{m.role ?? '—'} · {groupName(m.group_id)}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {!m.published && <Pill tone="slate">Draft</Pill>}
                    {m.accepts_new ? <Pill tone="green" dot>Accepting</Pill> : <Pill tone="amber">Waitlist</Pill>}
                  </div>
                </div>
              </motion.div>
            ))}
          </motion.div>
        )}
      </PageWrap>
  );
}
