'use client';
import { useEffect, useState } from 'react';
import AdminShell from '@/components/admin/AdminShell';
import { adminFetch } from '@/components/admin/useAdminAuth';

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

  const save = async () => {
    setSaving(true);
    const body = { ...form };
    if (editing) {
      await adminFetch(`/admin/content/team/members/${editing.id}`, { method: 'PUT', body: JSON.stringify(body) });
    } else {
      await adminFetch('/admin/content/team/members', { method: 'POST', body: JSON.stringify(body) });
    }
    setSaving(false);
    setEditing(null);
    setForm(emptyMember);
    load();
  };

  const del = async (id: number) => {
    if (!confirm('Delete this team member?')) return;
    await adminFetch(`/admin/content/team/members/${id}`, { method: 'DELETE' });
    load();
  };

  const groupName = (id: number | null) => groups.find((g) => g.id === id)?.title ?? '—';

  return (
    <AdminShell>
      <div className="p-6 max-w-5xl">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Team Members</h1>
          <button onClick={() => { setEditing(null); setForm(emptyMember); }}
            className="bg-blue-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-blue-700">+ Add Member</button>
        </div>

        {(editing !== null || form.full_name !== '') && (
          <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6 space-y-4">
            <h2 className="font-semibold text-gray-700">{editing ? 'Edit Member' : 'New Member'}</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Full Name</label>
                <input className="w-full border rounded-lg px-3 py-2 text-sm" value={form.full_name}
                  onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Group</label>
                <select className="w-full border rounded-lg px-3 py-2 text-sm"
                  value={form.group_id ?? ''}
                  onChange={(e) => setForm({ ...form, group_id: e.target.value ? +e.target.value : null })}>
                  <option value="">No group</option>
                  {groups.map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Credentials</label>
                <input className="w-full border rounded-lg px-3 py-2 text-sm" value={form.credentials ?? ''}
                  onChange={(e) => setForm({ ...form, credentials: e.target.value || null })} />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Role</label>
                <input className="w-full border rounded-lg px-3 py-2 text-sm" value={form.role ?? ''}
                  onChange={(e) => setForm({ ...form, role: e.target.value || null })} />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Email</label>
                <input type="email" className="w-full border rounded-lg px-3 py-2 text-sm" value={form.email ?? ''}
                  onChange={(e) => setForm({ ...form, email: e.target.value || null })} />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Photo URL</label>
                <input className="w-full border rounded-lg px-3 py-2 text-sm" value={form.photo_url ?? ''}
                  onChange={(e) => setForm({ ...form, photo_url: e.target.value || null })} />
              </div>
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Bio</label>
              <textarea className="w-full border rounded-lg px-3 py-2 text-sm h-24 resize-none" value={form.bio ?? ''}
                onChange={(e) => setForm({ ...form, bio: e.target.value || null })} />
            </div>
            <div className="flex gap-6">
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Position</label>
                <input type="number" className="w-24 border rounded-lg px-3 py-2 text-sm" value={form.position}
                  onChange={(e) => setForm({ ...form, position: +e.target.value })} />
              </div>
              <div className="flex items-end pb-1 gap-4">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={form.accepts_new}
                    onChange={(e) => setForm({ ...form, accepts_new: e.target.checked })} />
                  Accepts New Clients
                </label>
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
              <button onClick={() => { setEditing(null); setForm(emptyMember); }}
                className="text-sm px-4 py-2 rounded-lg border hover:bg-gray-50">Cancel</button>
            </div>
          </div>
        )}

        <div className="space-y-2">
          {members.map((m) => (
            <div key={m.id} className="bg-white rounded-xl border border-gray-100 p-4 flex items-center justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="font-medium text-sm text-gray-900">{m.full_name}</span>
                  {m.credentials && <span className="text-xs text-gray-500">{m.credentials}</span>}
                  {!m.published && <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">Draft</span>}
                </div>
                <div className="text-xs text-gray-500">{m.role ?? '—'} · {groupName(m.group_id)}</div>
              </div>
              <div className="flex gap-2 shrink-0">
                <button onClick={() => {
                  setEditing(m);
                  setForm({ group_id: m.group_id, full_name: m.full_name, credentials: m.credentials, role: m.role, bio: m.bio, photo_url: m.photo_url, email: m.email, accepts_new: m.accepts_new, position: m.position, published: m.published });
                }} className="text-xs text-blue-600 hover:underline">Edit</button>
                <button onClick={() => del(m.id)} className="text-xs text-red-600 hover:underline">Delete</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </AdminShell>
  );
}
