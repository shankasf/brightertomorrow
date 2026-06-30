'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { adminFetch } from '@/components/admin/useAdminAuth';
import {
  PageHeader, PageWrap, Card, Button, Input, Textarea, Field, Checkbox,
  Pill, EmptyState, ErrorBanner, TableCard, THead, TH, TD, SkeletonRows,
  InlineSpinner,
} from '@/components/admin/ui';
import { LuUsers } from 'react-icons/lu';
import type {
  Clinician, ClinicianListResponse, MatchConfig, MatchConfigResponse,
  MatchOption, MatchQuestion, MatchStats,
} from '@/components/match/types';

type Tab = 'clinicians' | 'questions' | 'metrics';

const TABS: { id: Tab; label: string }[] = [
  { id: 'clinicians', label: 'Clinicians' },
  { id: 'questions', label: 'Match questions' },
  { id: 'metrics', label: 'Metrics' },
];

export default function AdminMatchingPage() {
  const [tab, setTab] = useState<Tab>('clinicians');

  return (
    <PageWrap max="max-w-6xl">
      <PageHeader
        title="Therapist matching"
        subtitle="Manage the clinician roster, the public match quiz, and see how visitors are matching and booking. Roster + quiz are the single source for the website, chatbot, and phone agent."
      />

      {/* Tabs */}
      <div className="mb-6 flex gap-1 border-b border-[#E5E5E5]">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`relative -mb-px px-4 py-2.5 text-sm font-semibold transition-colors ${
              tab === t.id ? 'text-brand-700' : 'text-ink-soft hover:text-ink'
            }`}
          >
            {t.label}
            {tab === t.id && (
              <motion.span
                layoutId="matchTabUnderline"
                className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-brand"
                transition={{ type: 'spring', stiffness: 380, damping: 32 }}
              />
            )}
          </button>
        ))}
      </div>

      {tab === 'clinicians' && <CliniciansTab />}
      {tab === 'questions' && <QuestionsTab />}
      {tab === 'metrics' && <MetricsTab />}
    </PageWrap>
  );
}

// ── Clinicians tab ──────────────────────────────────────────────────────────
type ClinicianForm = Omit<Clinician, 'created_at' | 'updated_at'>;

const emptyClinician: ClinicianForm = {
  slug: '', name: '', credentials: '', initials: '', types: [], locations: [],
  telehealth: true, specialties: [], rate: '', in_network: true, staff_id: 0,
  photo_url: '', booking_url_virtual: '', booking_url_in_person: '',
  active: true, sort_order: 0,
};

const WINE = '#66202A';

function locationLabel(c: Clinician): string {
  return (
    [...(c.locations ?? []), c.telehealth ? 'telehealth' : null].filter(Boolean).join(', ') || '—'
  );
}

// Small round avatar shared by the desktop table and the mobile cards.
// Uses a plain <img> because uploaded photos are served from
// /v1/clinicians/<slug>/photo, which the in-container Next image optimizer
// can't reach (it's only routed at the ingress). Same-origin <img> just works.
function ClinicianAvatar({
  photoUrl,
  initials,
  name,
  size,
}: {
  photoUrl: string;
  initials: string;
  name: string;
  size: number;
}) {
  return (
    <span
      className="relative inline-flex shrink-0 overflow-hidden rounded-full ring-1 ring-inset ring-[#E5E5E5]"
      style={{ width: size, height: size }}
    >
      {photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photoUrl} alt={name} className="h-full w-full object-cover" />
      ) : (
        <span
          className="grid h-full w-full place-items-center text-[11px] font-bold text-white"
          style={{ backgroundColor: WINE }}
          aria-hidden
        >
          {initials || '—'}
        </span>
      )}
    </span>
  );
}

function BookingPills({ c }: { c: Clinician }) {
  return (
    <div className="flex flex-wrap gap-1">
      <Pill tone={c.booking_url_virtual?.trim() ? 'green' : 'slate'}>
        Virtual {c.booking_url_virtual?.trim() ? '✓' : '—'}
      </Pill>
      <Pill tone={c.booking_url_in_person?.trim() ? 'green' : 'slate'}>
        In-person {c.booking_url_in_person?.trim() ? '✓' : '—'}
      </Pill>
    </div>
  );
}

// Labelled key/value row used inside the mobile clinician cards.
function CardRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-3">
      <dt className="w-20 shrink-0 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink/55">
        {label}
      </dt>
      <dd className="min-w-0 flex-1 text-ink-soft">{children}</dd>
    </div>
  );
}

// Resize/compress client-side: the upload endpoint hard-limits 350 KB and only
// accepts jpeg/png/webp, so we draw onto a canvas capped at 512px on the
// longest side and re-encode as JPEG q=0.85.
function resizeImageToBlob(file: File, maxSide = 512): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new window.Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('canvas-unsupported'));
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('encode-failed'))),
        'image/jpeg',
        0.85,
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('decode-failed'));
    };
    img.src = url;
  });
}

// Image preview + upload/replace control. Replaces the old raw Photo URL box.
// The photo is keyed by slug server-side, so a slug is required before upload.
function PhotoField({
  slug,
  photoUrl,
  initials,
  onUploaded,
}: {
  slug: string;
  photoUrl: string;
  initials: string;
  onUploaded: (photoUrl: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState('');
  const disabled = !slug.trim();

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setErr('Please choose an image file (JPEG, PNG, or WebP).');
      return;
    }
    setErr('');
    setUploading(true);
    try {
      const blob = await resizeImageToBlob(file, 512);
      // Upload RAW image bytes — override adminFetch's default JSON header.
      const r = await adminFetch(`/admin/api/clinicians/${slug}/photo`, {
        method: 'POST',
        headers: { 'Content-Type': blob.type },
        body: blob,
      });
      if (!r.ok) throw new Error(`${r.status}`);
      const data = (await r.json()) as { ok: boolean; photo_url: string };
      onUploaded(data.photo_url); // ?v=<ms> busts the cache so the preview refreshes
    } catch {
      setErr('Upload failed. Please try a smaller or different image.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <Field
      label="Photo"
      hint={disabled ? 'Enter a slug first, then upload' : 'JPEG, PNG, or WebP — resized automatically'}
    >
      <div className="flex items-center gap-4">
        <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl ring-1 ring-inset ring-[#E5E5E5]">
          {photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={photoUrl}
              alt={initials ? `${initials} photo` : 'Clinician photo'}
              className="h-full w-full object-cover"
            />
          ) : (
            <span
              className="grid h-full w-full place-items-center text-lg font-bold text-white"
              style={{ backgroundColor: WINE }}
              aria-hidden
            >
              {initials || '—'}
            </span>
          )}
          {uploading && (
            <span className="absolute inset-0 grid place-items-center bg-white/70" aria-hidden>
              <InlineSpinner />
            </span>
          )}
        </div>
        <div className="min-w-0">
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            className="sr-only"
            tabIndex={-1}
            onChange={onPick}
          />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => inputRef.current?.click()}
            disabled={disabled || uploading}
            loading={uploading}
            aria-busy={uploading}
          >
            {uploading ? 'Uploading…' : photoUrl ? 'Replace photo' : 'Upload photo'}
          </Button>
          {err && (
            <p role="alert" className="mt-1.5 text-xs text-rose-600">
              {err}
            </p>
          )}
        </div>
      </div>
    </Field>
  );
}

function CliniciansTab() {
  const [items, setItems] = useState<Clinician[] | null>(null);
  const [error, setError] = useState('');
  const [config, setConfig] = useState<MatchConfig | null>(null);
  const [editing, setEditing] = useState<Clinician | null>(null);
  const [form, setForm] = useState<ClinicianForm>(emptyClinician);
  const [specialtiesText, setSpecialtiesText] = useState('');
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [viewing, setViewing] = useState<Clinician | null>(null);

  const load = useCallback(async () => {
    setError('');
    try {
      const [c, cfg] = await Promise.all([
        adminFetch('/admin/api/clinicians').then((r) => {
          if (!r.ok) throw new Error(`${r.status}`);
          return r.json() as Promise<ClinicianListResponse>;
        }),
        adminFetch('/admin/api/match-config')
          .then((r) => (r.ok ? (r.json() as Promise<MatchConfigResponse>) : null))
          .catch(() => null),
      ]);
      setItems(c.items ?? []);
      if (cfg?.config) setConfig(cfg.config);
    } catch {
      setError('Failed to load the clinician roster.');
      setItems([]);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  // Data-driven taxonomy: derive type/location options from the match config.
  const typeOptions: MatchOption[] = config?.questions.find((q) => q.id === 'type')?.options ?? [];
  const locationOptions: MatchOption[] =
    config?.questions.find((q) => q.id === 'location')?.options ?? [];

  const startNew = () => {
    setEditing(null);
    setForm(emptyClinician);
    setSpecialtiesText('');
    setOpen(true);
  };
  const startEdit = (c: Clinician) => {
    setEditing(c);
    setForm({
      slug: c.slug, name: c.name, credentials: c.credentials, initials: c.initials,
      types: c.types ?? [], locations: c.locations ?? [], telehealth: c.telehealth,
      specialties: c.specialties ?? [], rate: c.rate, in_network: c.in_network,
      staff_id: c.staff_id, photo_url: c.photo_url,
      booking_url_virtual: c.booking_url_virtual ?? '',
      booking_url_in_person: c.booking_url_in_person ?? '',
      active: c.active, sort_order: c.sort_order,
    });
    setSpecialtiesText((c.specialties ?? []).join(', '));
    setOpen(true);
  };
  const close = () => { setOpen(false); setEditing(null); setForm(emptyClinician); setSpecialtiesText(''); };

  const toggleIn = (key: 'types' | 'locations', value: string) => {
    setForm((f) => {
      const arr = f[key] ?? [];
      return { ...f, [key]: arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value] };
    });
  };

  const save = async () => {
    setSaving(true);
    setError('');
    const specialties = specialtiesText.split(',').map((s) => s.trim()).filter(Boolean);
    const payload = { ...form, specialties };
    try {
      const r = editing
        ? await adminFetch(`/admin/api/clinicians/${editing.slug}`, {
            method: 'PUT', body: JSON.stringify(payload),
          })
        : await adminFetch('/admin/api/clinicians', {
            method: 'POST', body: JSON.stringify(payload),
          });
      if (!r.ok) throw new Error(`${r.status}`);
      close();
      await load();
    } catch {
      setError(editing ? 'Could not save changes.' : 'Could not create the clinician (slug may already exist).');
    } finally {
      setSaving(false);
    }
  };

  const archive = async (c: Clinician) => {
    if (!confirm(`Archive ${c.name}? They'll be hidden from matching but not deleted.`)) return;
    setError('');
    try {
      const r = await adminFetch(`/admin/api/clinicians/${c.slug}`, { method: 'DELETE' });
      if (!r.ok) throw new Error(`${r.status}`);
      await load();
    } catch {
      setError('Could not archive the clinician.');
    }
  };

  return (
    <div>
      {error && <ErrorBanner>{error}</ErrorBanner>}

      <div className="mb-4 flex justify-end">
        <Button onClick={startNew}>＋ Add clinician</Button>
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/40 p-4 backdrop-blur-sm sm:items-center"
            onClick={close}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.97, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97, y: 8 }}
              transition={{ duration: 0.18 }}
              onClick={(e) => e.stopPropagation()}
              className="my-8 w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-[#E5E5E5]"
            >
              <div className="flex items-start justify-between gap-4 border-b border-[#EFEFEF] bg-gradient-to-br from-brand-50/40 via-white to-white p-5">
                <h2 className="text-base font-semibold text-ink">
                  {editing ? `Edit ${editing.name}` : 'New clinician'}
                </h2>
                <button onClick={close} className="shrink-0 rounded-lg p-1.5 text-ink-soft transition hover:bg-cream hover:text-ink" aria-label="Close">✕</button>
              </div>
              <div className="space-y-4 p-5">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field label="Slug" hint={editing ? 'Cannot be changed' : 'Unique, e.g. elisia-danley'}>
                    <Input
                      value={form.slug}
                      disabled={!!editing}
                      onChange={(e) => setForm({ ...form, slug: e.target.value })}
                      placeholder="elisia-danley"
                    />
                  </Field>
                  <Field label="Full name">
                    <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                  </Field>
                  <Field label="Credentials">
                    <Input value={form.credentials} onChange={(e) => setForm({ ...form, credentials: e.target.value })} placeholder="LCSW" />
                  </Field>
                  <Field label="Initials">
                    <Input value={form.initials} onChange={(e) => setForm({ ...form, initials: e.target.value })} placeholder="ED" />
                  </Field>
                  <Field label="Rate">
                    <Input value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} placeholder="$125 / session" />
                  </Field>
                  <Field label="Jane staff ID" hint="0 if not bookable">
                    <Input type="number" value={form.staff_id} onChange={(e) => setForm({ ...form, staff_id: +e.target.value })} />
                  </Field>
                  <Field label="Sort order">
                    <Input type="number" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: +e.target.value })} />
                  </Field>
                </div>

                <PhotoField
                  slug={form.slug}
                  photoUrl={form.photo_url}
                  initials={form.initials}
                  onUploaded={(url) => setForm((f) => ({ ...f, photo_url: url }))}
                />

                <Field label="Support types" hint="Which quiz 'type' answers this clinician matches">
                  <div className="flex flex-wrap gap-3 pt-1">
                    {typeOptions.length === 0 && <span className="text-xs text-ink-soft">No type options in the quiz config.</span>}
                    {typeOptions.map((o) => (
                      <Checkbox
                        key={o.value}
                        label={o.label}
                        checked={(form.types ?? []).includes(o.value)}
                        onChange={() => toggleIn('types', o.value)}
                      />
                    ))}
                  </div>
                </Field>

                <Field label="In-person locations" hint="Leave empty for telehealth-only clinicians">
                  <div className="flex flex-wrap gap-3 pt-1">
                    {locationOptions.length === 0 && <span className="text-xs text-ink-soft">No location options in the quiz config.</span>}
                    {locationOptions.map((o) => (
                      <Checkbox
                        key={o.value}
                        label={o.label}
                        checked={(form.locations ?? []).includes(o.value)}
                        onChange={() => toggleIn('locations', o.value)}
                      />
                    ))}
                  </div>
                </Field>

                <Field label="Specialties" hint="Comma-separated, e.g. Anxiety, Trauma, Family">
                  <Input value={specialtiesText} onChange={(e) => setSpecialtiesText(e.target.value)} placeholder="Anxiety, Trauma, Family" />
                </Field>

                <div className="rounded-lg border border-[#E5E5E5] bg-cream/40 p-3.5">
                  <div className="mb-1 text-[11px] font-bold uppercase tracking-[0.1em] text-ink/70">
                    Booking links
                  </div>
                  <p className="mb-3 text-xs text-ink-soft">
                    Where Get Scheduled sends a visitor who picks this clinician. The form uses the
                    virtual link for telehealth and the in-person link for in-person. Leave a box
                    blank to fall back to the other link, then to the main Jane booking page.
                  </p>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Field label="Virtual / telehealth link" hint="Provider's video-visit booking URL">
                      <Input
                        type="url"
                        value={form.booking_url_virtual ?? ''}
                        onChange={(e) => setForm({ ...form, booking_url_virtual: e.target.value })}
                        placeholder="https://brightertomorrow.janeapp.com/#/staff_member/47"
                      />
                    </Field>
                    <Field label="In-person link" hint="Provider's in-office booking URL">
                      <Input
                        type="url"
                        value={form.booking_url_in_person ?? ''}
                        onChange={(e) => setForm({ ...form, booking_url_in_person: e.target.value })}
                        placeholder="https://brightertomorrow.janeapp.com/#/staff_member/47"
                      />
                    </Field>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-5 pt-1">
                  <Checkbox label="Offers telehealth" checked={form.telehealth} onChange={(e) => setForm({ ...form, telehealth: e.target.checked })} />
                  <Checkbox label="In-network" checked={form.in_network} onChange={(e) => setForm({ ...form, in_network: e.target.checked })} />
                  <Checkbox label="Active" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
                </div>
              </div>
              <div className="flex items-center gap-2 border-t border-[#EFEFEF] bg-cream/40 p-4">
                <Button onClick={save} loading={saving} disabled={!form.slug.trim() || !form.name.trim()}>
                  {saving ? 'Saving…' : 'Save'}
                </Button>
                <Button variant="secondary" onClick={close} className="ml-auto">Cancel</Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {!items ? (
        <SkeletonRows rows={6} cols={9} />
      ) : items.length === 0 ? (
        <EmptyState
          title="No clinicians yet"
          description="Add your first clinician to power the match quiz."
          action={<Button onClick={startNew}>＋ Add clinician</Button>}
          icon={<LuUsers width={22} height={22} strokeWidth={1.8} />}
        />
      ) : (
        <>
          {/* Desktop: a real table from lg up. */}
          <div className="hidden lg:block">
            <TableCard>
              <THead>
                <tr>
                  <TH>Name</TH>
                  <TH>Types</TH>
                  <TH>Locations</TH>
                  <TH>Specialties</TH>
                  <TH>Rate</TH>
                  <TH>Booking links</TH>
                  <TH>Network</TH>
                  <TH>Status</TH>
                  <TH>Order</TH>
                  <TH>Actions</TH>
                </tr>
              </THead>
              <tbody>
                {items.map((c) => (
                  <tr
                    key={c.slug}
                    onClick={() => setViewing(c)}
                    className={`cursor-pointer transition-colors hover:bg-cream/50 ${c.active ? '' : 'opacity-60'}`}
                  >
                    <TD className="whitespace-nowrap">
                      <div className="flex items-center gap-2.5">
                        <ClinicianAvatar photoUrl={c.photo_url} initials={c.initials} name={c.name} size={36} />
                        <div>
                          <div className="font-medium text-ink">{c.name}</div>
                          <div className="text-[12px] text-ink-soft">{c.credentials}</div>
                        </div>
                      </div>
                    </TD>
                    <TD className="text-[12.5px] text-ink-soft">{(c.types ?? []).join(', ') || '—'}</TD>
                    <TD className="text-[12.5px] text-ink-soft">{locationLabel(c)}</TD>
                    <TD className="text-[12.5px] text-ink-soft max-w-[14rem]">{(c.specialties ?? []).join(', ') || '—'}</TD>
                    <TD className="whitespace-nowrap text-[12.5px]">{c.rate || '—'}</TD>
                    <TD className="whitespace-nowrap"><BookingPills c={c} /></TD>
                    <TD>{c.in_network ? <Pill tone="green">In-network</Pill> : <Pill tone="slate">Out-of-network</Pill>}</TD>
                    <TD>{c.active ? <Pill tone="green" dot>Active</Pill> : <Pill tone="slate">Archived</Pill>}</TD>
                    <TD className="tabular-nums">{c.sort_order}</TD>
                    <TD className="whitespace-nowrap">
                      <div className="flex gap-1">
                        <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); startEdit(c); }}>Edit</Button>
                        {c.active && (
                          <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); archive(c); }} className="!text-rose-600 hover:!bg-rose-50">
                            Archive
                          </Button>
                        )}
                      </div>
                    </TD>
                  </tr>
                ))}
              </tbody>
            </TableCard>
          </div>

          {/* Below lg: stacked cards — no horizontal scroll down to 320px. */}
          <div className="space-y-3 lg:hidden">
            {items.map((c) => (
              <Card
                key={c.slug}
                onClick={() => setViewing(c)}
                className={`cursor-pointer ${c.active ? '' : 'opacity-60'}`}
              >
                <div className="flex items-start gap-3">
                  <ClinicianAvatar photoUrl={c.photo_url} initials={c.initials} name={c.name} size={44} />
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-ink">{c.name}</div>
                    <div className="text-[12.5px] text-ink-soft">{c.credentials}</div>
                  </div>
                  <div className="shrink-0">
                    {c.active ? <Pill tone="green" dot>Active</Pill> : <Pill tone="slate">Archived</Pill>}
                  </div>
                </div>

                <dl className="mt-3.5 space-y-2.5 text-[12.5px]">
                  <CardRow label="Types">{(c.types ?? []).join(', ') || '—'}</CardRow>
                  <CardRow label="Locations">{locationLabel(c)}</CardRow>
                  <CardRow label="Specialties">{(c.specialties ?? []).join(', ') || '—'}</CardRow>
                  <CardRow label="Rate">{c.rate || '—'}</CardRow>
                  <CardRow label="Booking"><BookingPills c={c} /></CardRow>
                  <CardRow label="Network">
                    {c.in_network ? <Pill tone="green">In-network</Pill> : <Pill tone="slate">Out-of-network</Pill>}
                  </CardRow>
                  <CardRow label="Order"><span className="tabular-nums">{c.sort_order}</span></CardRow>
                </dl>

                <div className="mt-3.5 flex gap-1 border-t border-[#EFEFEF] pt-3">
                  <Button variant="secondary" size="sm" onClick={(e) => { e.stopPropagation(); startEdit(c); }}>Edit</Button>
                  {c.active && (
                    <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); archive(c); }} className="!text-rose-600 hover:!bg-rose-50">
                      Archive
                    </Button>
                  )}
                </div>
              </Card>
            ))}
          </div>
        </>
      )}

      <AnimatePresence>
        {viewing && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/40 p-4 backdrop-blur-sm sm:items-center"
            onClick={() => setViewing(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.97, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97, y: 8 }}
              transition={{ duration: 0.18 }}
              onClick={(e) => e.stopPropagation()}
              className="my-8 w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-[#E5E5E5]"
            >
              <div className="flex items-start gap-4 border-b border-[#EFEFEF] bg-gradient-to-br from-brand-50/40 via-white to-white p-5">
                <ClinicianAvatar photoUrl={viewing.photo_url} initials={viewing.initials} name={viewing.name} size={64} />
                <div className="min-w-0 flex-1">
                  <h2 className="text-base font-semibold text-ink">{viewing.name}</h2>
                  {viewing.credentials && <p className="text-sm text-ink-soft">{viewing.credentials}</p>}
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {viewing.active ? <Pill tone="green" dot>Active</Pill> : <Pill tone="slate">Archived</Pill>}
                    {viewing.in_network ? <Pill tone="green">In-network</Pill> : <Pill tone="slate">Out-of-network</Pill>}
                  </div>
                </div>
                <button onClick={() => setViewing(null)} className="shrink-0 rounded-lg p-1.5 text-ink-soft transition hover:bg-cream hover:text-ink" aria-label="Close">✕</button>
              </div>

              <div className="space-y-3.5 p-5">
                <DetailRow label="Slug" value={viewing.slug} />
                <DetailRow label="Support types" value={(viewing.types ?? []).join(', ') || null} />
                <DetailRow label="Locations" value={locationLabel(viewing)} />
                <DetailRow label="Telehealth" value={viewing.telehealth ? 'Yes' : 'No'} />
                <DetailRow label="Specialties" value={(viewing.specialties ?? []).join(', ') || null} />
                <DetailRow label="Rate" value={viewing.rate || null} />
                <DetailRow label="Jane staff ID" value={viewing.staff_id ? String(viewing.staff_id) : null} />
                <DetailRow label="Virtual link" value={viewing.booking_url_virtual || null} link />
                <DetailRow label="In-person link" value={viewing.booking_url_in_person || null} link />
                <DetailRow label="Sort order" value={String(viewing.sort_order)} />
              </div>

              <div className="flex items-center gap-2 border-t border-[#EFEFEF] bg-cream/40 p-4">
                <Button onClick={() => { const c = viewing; setViewing(null); startEdit(c); }}>Edit</Button>
                {viewing.active && (
                  <Button variant="danger" onClick={() => { const c = viewing; setViewing(null); archive(c); }}>Archive</Button>
                )}
                <Button variant="secondary" onClick={() => setViewing(null)} className="ml-auto">Close</Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function DetailRow({ label, value, link }: { label: string; value: string | null; link?: boolean }) {
  return (
    <div className="grid grid-cols-3 gap-3">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink/55">{label}</dt>
      <dd className="col-span-2 break-words text-sm text-ink-soft">
        {value ? (
          link ? (
            <a href={value} target="_blank" rel="noopener noreferrer" className="text-brand-700 underline decoration-brand-200 underline-offset-2 hover:text-brand">{value}</a>
          ) : (
            value
          )
        ) : (
          <span className="text-ink/30">—</span>
        )}
      </dd>
    </div>
  );
}

// ── Match questions tab ─────────────────────────────────────────────────────
// Compact labelled wrapper for the inline option-row inputs, so each box is
// wide enough to show its full text and stays identifiable once filled.
function OptField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.08em] text-ink/55">
        {label}
      </span>
      {children}
    </label>
  );
}

function QuestionsTab() {
  const [config, setConfig] = useState<MatchConfig | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const r = await adminFetch('/admin/api/match-config');
      if (!r.ok) throw new Error(`${r.status}`);
      const data = (await r.json()) as MatchConfigResponse;
      setConfig(data.config);
    } catch {
      setError('Failed to load the quiz configuration.');
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const patchQuestion = (qi: number, patch: Partial<MatchQuestion>) => {
    setConfig((c) => {
      if (!c) return c;
      const questions = c.questions.map((q, i) => (i === qi ? { ...q, ...patch } : q));
      return { ...c, questions };
    });
  };
  const patchOption = (qi: number, oi: number, patch: Partial<MatchOption>) => {
    setConfig((c) => {
      if (!c) return c;
      const questions = c.questions.map((q, i) => {
        if (i !== qi) return q;
        const options = q.options.map((o, j) => (j === oi ? { ...o, ...patch } : o));
        return { ...q, options };
      });
      return { ...c, questions };
    });
  };
  const addOption = (qi: number) => {
    setConfig((c) => {
      if (!c) return c;
      const questions = c.questions.map((q, i) =>
        i === qi ? { ...q, options: [...q.options, { value: '', label: '', desc: '', icon: '' }] } : q,
      );
      return { ...c, questions };
    });
  };
  const removeOption = (qi: number, oi: number) => {
    setConfig((c) => {
      if (!c) return c;
      const questions = c.questions.map((q, i) =>
        i === qi ? { ...q, options: q.options.filter((_, j) => j !== oi) } : q,
      );
      return { ...c, questions };
    });
  };

  const save = async () => {
    if (!config) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const r = await adminFetch('/admin/api/match-config', {
        method: 'PUT', body: JSON.stringify({ config }),
      });
      if (!r.ok) throw new Error(`${r.status}`);
      setNotice('Quiz configuration saved.');
    } catch {
      setError('Could not save the quiz configuration.');
    } finally {
      setSaving(false);
    }
  };

  if (error && !config) return <ErrorBanner>{error}</ErrorBanner>;
  if (!config) return <SkeletonRows rows={4} cols={2} label="Loading quiz" />;

  return (
    <div className="space-y-5">
      {error && <ErrorBanner>{error}</ErrorBanner>}
      {notice && (
        <div role="status" aria-live="polite" className="rounded-xl border border-emerald-200/70 bg-emerald-50/80 px-4 py-3 text-sm text-emerald-800">
          {notice}
        </div>
      )}

      <Card>
        <h2 className="mb-4 text-sm font-semibold text-ink">Intro copy</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Eyebrow">
            <Input value={config.intro_eyebrow ?? ''} onChange={(e) => setConfig({ ...config, intro_eyebrow: e.target.value })} />
          </Field>
          <Field label="Title">
            <Input value={config.intro_title ?? ''} onChange={(e) => setConfig({ ...config, intro_title: e.target.value })} />
          </Field>
          <Field label="Sub">
            <Input value={config.intro_sub ?? ''} onChange={(e) => setConfig({ ...config, intro_sub: e.target.value })} />
          </Field>
        </div>
      </Card>

      {config.questions.map((q, qi) => (
        <Card key={q.id}>
          <div className="mb-3 flex items-center justify-between gap-3">
            <span className="rounded-full bg-brand-50 px-2.5 py-0.5 text-[11px] font-semibold text-brand-700 ring-1 ring-inset ring-brand-200/70">
              {q.id}{q.in_person_only ? ' · shown only for in-person' : ''}
            </span>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Question">
              <Input value={q.question} onChange={(e) => patchQuestion(qi, { question: e.target.value })} />
            </Field>
            <Field label="Sub-text">
              <Input value={q.sub ?? ''} onChange={(e) => patchQuestion(qi, { sub: e.target.value })} />
            </Field>
          </div>

          <div className="mt-4">
            <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.1em] text-ink/70">Options</div>
            <div className="space-y-2">
              {q.options.map((o, oi) => (
                <div key={oi} className="grid grid-cols-1 items-end gap-2 rounded-lg border border-[#E5E5E5] bg-cream/40 p-2.5 lg:grid-cols-[4.5rem_minmax(8rem,1fr)_minmax(10rem,1.3fr)_minmax(14rem,2fr)_auto]">
                  <OptField label="Icon"><Input placeholder="🧠" value={o.icon ?? ''} onChange={(e) => patchOption(qi, oi, { icon: e.target.value })} /></OptField>
                  <OptField label="Value"><Input placeholder="therapy" value={o.value} onChange={(e) => patchOption(qi, oi, { value: e.target.value })} /></OptField>
                  <OptField label="Label"><Input placeholder="Therapy" value={o.label} onChange={(e) => patchOption(qi, oi, { label: e.target.value })} /></OptField>
                  <OptField label="Description"><Input placeholder="Individual sessions for adults 18+" value={o.desc ?? ''} onChange={(e) => patchOption(qi, oi, { desc: e.target.value })} /></OptField>
                  <Button variant="ghost" size="sm" onClick={() => removeOption(qi, oi)} className="!text-rose-600 hover:!bg-rose-50">Remove</Button>
                </div>
              ))}
            </div>
            <div className="mt-2">
              <Button variant="secondary" size="sm" onClick={() => addOption(qi)}>＋ Add option</Button>
            </div>
          </div>
        </Card>
      ))}

      <div className="flex items-center gap-2">
        <Button onClick={save} loading={saving}>{saving ? 'Saving…' : 'Save quiz'}</Button>
        <Button variant="secondary" onClick={() => void load()}>Reset</Button>
      </div>
    </div>
  );
}

// ── Metrics tab ─────────────────────────────────────────────────────────────
const METRIC_LABELS: Record<string, string> = {
  by_type: 'By support type',
  by_modality: 'By format',
  by_location: 'By location',
  by_insurance: 'By insurance preference',
};

function MetricsTab() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [stats, setStats] = useState<MatchStats | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setStats(null);
    setError('');
    try {
      const u = new URLSearchParams();
      if (from) u.set('from', from);
      if (to) u.set('to', to);
      const r = await adminFetch(`/admin/api/match-stats${u.toString() ? `?${u.toString()}` : ''}`);
      if (!r.ok) throw new Error(`${r.status}`);
      setStats((await r.json()) as MatchStats);
    } catch {
      setError('Failed to load match metrics.');
    }
  }, [from, to]);
  useEffect(() => { void load(); }, [load]);

  const pickRate = useMemo(() => {
    if (!stats || stats.total === 0) return 0;
    return Math.round((stats.pick_through_count / stats.total) * 100);
  }, [stats]);
  const noResultRate = useMemo(() => {
    if (!stats || stats.total === 0) return 0;
    return Math.round((stats.no_result_count / stats.total) * 100);
  }, [stats]);

  return (
    <div>
      {error && <ErrorBanner>{error}</ErrorBanner>}

      <div className="mb-5 flex flex-wrap items-end gap-3">
        <label className="flex flex-col text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-soft">
          From
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="!mt-1" />
        </label>
        <label className="flex flex-col text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-soft">
          To
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="!mt-1" />
        </label>
      </div>

      {!stats ? (
        <SkeletonRows rows={3} cols={4} label="Loading metrics" />
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label="Quizzes taken" value={stats.total} />
            <StatCard label="Booked after match" value={stats.pick_through_count} sub={`${pickRate}% pick-through`} />
            <StatCard label="No matches found" value={stats.no_result_count} sub={`${noResultRate}% of quizzes`} />
            <StatCard label="Most-picked" value={stats.top_picked?.[0]?.slug ?? '—'} small />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {(['by_type', 'by_modality', 'by_location', 'by_insurance'] as const).map((key) => (
              <Breakdown key={key} title={METRIC_LABELS[key]} data={stats[key]} />
            ))}
          </div>

          <Card>
            <h3 className="mb-3 text-sm font-semibold text-ink">Most-picked clinicians</h3>
            {(!stats.top_picked || stats.top_picked.length === 0) ? (
              <p className="text-sm text-ink-soft">No picks recorded for this range yet.</p>
            ) : (
              <ul className="space-y-1.5">
                {stats.top_picked.map((p) => (
                  <li key={p.slug} className="flex items-center justify-between text-sm">
                    <span className="text-ink">{p.slug}</span>
                    <span className="font-semibold tabular-nums text-ink">{p.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, sub, small }: { label: string; value: number | string; sub?: string; small?: boolean }) {
  return (
    <Card padded>
      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-soft">{label}</div>
      <div className={`mt-1 font-bold tabular-nums text-ink ${small ? 'text-base truncate' : 'text-2xl'}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[12px] text-ink-soft">{sub}</div>}
    </Card>
  );
}

function Breakdown({ title, data }: { title: string; data: Record<string, number> }) {
  const entries = Object.entries(data ?? {}).sort((a, b) => b[1] - a[1]);
  const max = entries.reduce((m, [, v]) => Math.max(m, v), 0) || 1;
  return (
    <Card>
      <h3 className="mb-3 text-sm font-semibold text-ink">{title}</h3>
      {entries.length === 0 ? (
        <p className="text-sm text-ink-soft">No data for this range.</p>
      ) : (
        <ul className="space-y-2">
          {entries.map(([k, v]) => (
            <li key={k}>
              <div className="mb-1 flex items-center justify-between text-[12.5px]">
                <span className="text-ink">{k}</span>
                <span className="font-semibold tabular-nums text-ink-soft">{v}</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-cream">
                <div className="h-full rounded-full bg-brand" style={{ width: `${(v / max) * 100}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
