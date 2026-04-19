'use client';
import { useEffect, useState } from 'react';
import AdminShell from '@/components/admin/AdminShell';
import { adminFetch } from '@/components/admin/useAdminAuth';

type Settings = {
  brand_name: string; tagline: string | null; primary_phone: string | null; primary_email: string | null;
  primary_color: string; text_color: string; muted_color: string; surface_color: string;
  logo_url: string | null; hero_image_url: string | null;
};

export default function SettingsPage() {
  const [form, setForm] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    adminFetch('/admin/content/settings').then((r) => r.json()).then(setForm);
  }, []);

  const save = async () => {
    if (!form) return;
    setSaving(true);
    setSaved(false);
    await adminFetch('/admin/content/settings', { method: 'PUT', body: JSON.stringify(form) });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const f = (key: keyof Settings) => ({
    value: (form?.[key] as string) ?? '',
    onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
      form && setForm({ ...form, [key]: e.target.value || null }),
  });

  return (
    <AdminShell>
      <div className="p-6 max-w-2xl">
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Site Settings</h1>

        {form ? (
          <div className="bg-white rounded-xl border border-gray-100 p-6 space-y-4">
            {[
              ['Brand Name', 'brand_name'],
              ['Tagline', 'tagline'],
              ['Primary Phone', 'primary_phone'],
              ['Primary Email', 'primary_email'],
              ['Primary Color', 'primary_color'],
              ['Text Color', 'text_color'],
              ['Muted Color', 'muted_color'],
              ['Surface Color', 'surface_color'],
              ['Logo URL', 'logo_url'],
              ['Hero Image URL', 'hero_image_url'],
            ].map(([label, key]) => (
              <div key={key}>
                <label className="text-xs text-gray-500 mb-1 block">{label}</label>
                <input className="w-full border rounded-lg px-3 py-2 text-sm" {...f(key as keyof Settings)} />
              </div>
            ))}

            <div className="flex items-center gap-3 pt-2">
              <button disabled={saving} onClick={save}
                className="bg-blue-600 text-white text-sm px-5 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-40">
                {saving ? 'Saving…' : 'Save Changes'}
              </button>
              {saved && <span className="text-sm text-green-600">✓ Saved</span>}
            </div>
          </div>
        ) : <div className="text-gray-400">Loading…</div>}
      </div>
    </AdminShell>
  );
}
