'use client';
import { useEffect, useState } from 'react';
import AdminShell from '@/components/admin/AdminShell';
import { adminFetch } from '@/components/admin/useAdminAuth';

type Location = { id: number; name: string; address1: string | null; address2: string | null; city: string | null; state: string | null; postal_code: string | null; phone: string | null; is_telehealth: boolean; position: number };
type LocationForm = Omit<Location, 'id'>;
const empty: LocationForm = { name: '', address1: null, address2: null, city: null, state: null, postal_code: null, phone: null, is_telehealth: false, position: 0 };

export default function LocationsPage() {
  const [items, setItems] = useState<Location[]>([]);
  const [editing, setEditing] = useState<Location | null>(null);
  const [form, setForm] = useState<LocationForm>(empty);
  const [saving, setSaving] = useState(false);

  const load = () => adminFetch('/admin/content/locations').then((r) => r.json()).then((d) => setItems(d.locations));
  useEffect(() => { load(); }, []);

  const save = async () => {
    setSaving(true);
    if (editing) await adminFetch(`/admin/content/locations/${editing.id}`, { method: 'PUT', body: JSON.stringify(form) });
    else await adminFetch('/admin/content/locations', { method: 'POST', body: JSON.stringify(form) });
    setSaving(false); setEditing(null); setForm(empty); load();
  };
  const del = async (id: number) => {
    if (!confirm('Delete?')) return;
    await adminFetch(`/admin/content/locations/${id}`, { method: 'DELETE' }); load();
  };
  const sf = (key: keyof LocationForm) => ({
    value: (form[key] as string) ?? '',
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: e.target.value || null }),
  });

  return (
    <AdminShell>
      <div className="p-6 max-w-4xl">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Locations</h1>
          <button onClick={() => { setEditing(null); setForm(empty); }} className="bg-blue-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-blue-700">+ Add Location</button>
        </div>

        {(editing !== null || form.name !== '') && (
          <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              {([['Name', 'name'], ['Address Line 1', 'address1'], ['Address Line 2', 'address2'], ['City', 'city'], ['State', 'state'], ['Zip', 'postal_code'], ['Phone', 'phone']] as const).map(([label, key]) => (
                <div key={key}>
                  <label className="text-xs text-gray-500 mb-1 block">{label}</label>
                  <input className="w-full border rounded-lg px-3 py-2 text-sm" {...sf(key)} />
                </div>
              ))}
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Position</label>
                <input type="number" className="w-full border rounded-lg px-3 py-2 text-sm" value={form.position}
                  onChange={(e) => setForm({ ...form, position: +e.target.value })} />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={form.is_telehealth} onChange={(e) => setForm({ ...form, is_telehealth: e.target.checked })} /> Telehealth
            </label>
            <div className="flex gap-2">
              <button disabled={saving} onClick={save} className="bg-blue-600 text-white text-sm px-4 py-2 rounded-lg disabled:opacity-40">{saving ? 'Saving…' : 'Save'}</button>
              <button onClick={() => { setEditing(null); setForm(empty); }} className="text-sm px-4 py-2 rounded-lg border">Cancel</button>
            </div>
          </div>
        )}

        <div className="space-y-2">
          {items.map((loc) => (
            <div key={loc.id} className="bg-white rounded-xl border border-gray-100 p-4 flex items-center justify-between gap-4">
              <div>
                <span className="font-medium text-sm text-gray-900">{loc.name}</span>
                {loc.is_telehealth && <span className="ml-2 text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">Telehealth</span>}
                <div className="text-xs text-gray-500 mt-0.5">{[loc.address1, loc.city, loc.state].filter(Boolean).join(', ')}</div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => { setEditing(loc); setForm({ name: loc.name, address1: loc.address1, address2: loc.address2, city: loc.city, state: loc.state, postal_code: loc.postal_code, phone: loc.phone, is_telehealth: loc.is_telehealth, position: loc.position }); }} className="text-xs text-blue-600 hover:underline">Edit</button>
                <button onClick={() => del(loc.id)} className="text-xs text-red-600 hover:underline">Delete</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </AdminShell>
  );
}
