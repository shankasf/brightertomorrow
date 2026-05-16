'use client';
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { adminFetch } from '@/components/admin/useAdminAuth';
import {
  PageHeader, PageWrap, Card, Button, Input, Field, LoadingScreen,
} from '@/components/admin/ui';
import { LuCheck } from 'react-icons/lu';

type Settings = {
  brand_name: string; tagline: string | null; primary_phone: string | null; primary_email: string | null;
  primary_color: string; text_color: string; muted_color: string; surface_color: string;
  logo_url: string | null; hero_image_url: string | null;
};

const fields: { label: string; key: keyof Settings; type?: string; group: 'identity' | 'contact' | 'theme' | 'media' }[] = [
  { label: 'Brand name', key: 'brand_name', group: 'identity' },
  { label: 'Tagline', key: 'tagline', group: 'identity' },
  { label: 'Primary phone', key: 'primary_phone', group: 'contact' },
  { label: 'Primary email', key: 'primary_email', group: 'contact' },
  { label: 'Primary color', key: 'primary_color', type: 'color', group: 'theme' },
  { label: 'Text color', key: 'text_color', type: 'color', group: 'theme' },
  { label: 'Muted color', key: 'muted_color', type: 'color', group: 'theme' },
  { label: 'Surface color', key: 'surface_color', type: 'color', group: 'theme' },
  { label: 'Logo URL', key: 'logo_url', group: 'media' },
  { label: 'Hero image URL', key: 'hero_image_url', group: 'media' },
];

const sections = [
  { id: 'identity' as const, title: 'Identity', desc: 'Brand name and tagline displayed across the site.' },
  { id: 'contact' as const, title: 'Contact', desc: 'How visitors reach the practice.' },
  { id: 'theme' as const, title: 'Theme', desc: 'Color tokens used by the public site.' },
  { id: 'media' as const, title: 'Media', desc: 'Logo and hero image URLs.' },
];

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

  return (
      <PageWrap max="max-w-3xl">
        <PageHeader
          title="Site settings"
          subtitle="Identity, contact details, theme, and media used across the public site."
          action={
            <div className="flex items-center gap-2">
              <AnimatePresence>
                {saved && (
                  <motion.span
                    initial={{ opacity: 0, x: 6 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 6 }}
                    className="inline-flex items-center gap-1 text-sm font-medium text-emerald-600"
                  >
                    <LuCheck width={14} height={14} strokeWidth={2.5} />
                    Saved
                  </motion.span>
                )}
              </AnimatePresence>
              <Button onClick={save} loading={saving} disabled={!form}>
                {saving ? 'Saving…' : 'Save changes'}
              </Button>
            </div>
          }
        />

        {!form ? (
          <LoadingScreen label="Loading settings" height={320} />
        ) : (
          <div className="space-y-5">
            {sections.map((sec) => (
              <Card key={sec.id}>
                <div className="mb-4 flex items-baseline justify-between">
                  <div>
                    <h2 className="text-sm font-semibold text-slate-900">{sec.title}</h2>
                    <p className="mt-0.5 text-xs text-slate-500">{sec.desc}</p>
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {fields.filter((f) => f.group === sec.id).map((f) => (
                    <div key={f.key}>
                      <Field label={f.label}>
                        {f.type === 'color' ? (
                          <div className="flex items-stretch gap-2">
                            <input
                              type="color"
                              value={(form[f.key] as string) || '#000000'}
                              onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                              className="h-9 w-12 cursor-pointer rounded-lg border border-slate-200 bg-white p-0.5 shadow-sm"
                            />
                            <Input
                              value={(form[f.key] as string) ?? ''}
                              onChange={(e) => setForm({ ...form, [f.key]: e.target.value || null })}
                              className="font-mono uppercase"
                            />
                          </div>
                        ) : (
                          <Input
                            value={(form[f.key] as string) ?? ''}
                            onChange={(e) => setForm({ ...form, [f.key]: e.target.value || null })}
                          />
                        )}
                      </Field>
                    </div>
                  ))}
                </div>
              </Card>
            ))}
          </div>
        )}
      </PageWrap>
  );
}
