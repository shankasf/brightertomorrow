'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { adminFetch } from '@/components/admin/useAdminAuth';
import {
  PageHeader, PageWrap, Card, Button, Input, Textarea, Field, Checkbox,
  Pill, EmptyState, ErrorBanner, TableCard, THead, TH, TD, SkeletonRows,
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
  photo_url: '', active: true, sort_order: 0,
};

function CliniciansTab() {
  const [items, setItems] = useState<Clinician[] | null>(null);
  const [error, setError] = useState('');
  const [config, setConfig] = useState<MatchConfig | null>(null);
  const [editing, setEditing] = useState<Clinician | null>(null);
  const [form, setForm] = useState<ClinicianForm>(emptyClinician);
  const [specialtiesText, setSpecialtiesText] = useState('');
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

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
      staff_id: c.staff_id, photo_url: c.photo_url, active: c.active, sort_order: c.sort_order,
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
            initial={{ opacity: 0, y: -6, height: 0 }}
            animate={{ opacity: 1, y: 0, height: 'auto' }}
            exit={{ opacity: 0, y: -6, height: 0 }}
            transition={{ duration: 0.22 }}
            className="mb-6 overflow-hidden"
          >
            <Card className="border-brand-200/70 bg-gradient-to-br from-brand-50/40 via-white to-white">
              <h2 className="mb-4 text-sm font-semibold text-ink">
                {editing ? `Edit ${editing.name}` : 'New clinician'}
              </h2>
              <div className="space-y-4">
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
                  <Field label="Photo URL">
                    <Input value={form.photo_url} onChange={(e) => setForm({ ...form, photo_url: e.target.value })} placeholder="/team/elisia-danley.jpg" />
                  </Field>
                  <Field label="Jane staff ID" hint="0 if not bookable">
                    <Input type="number" value={form.staff_id} onChange={(e) => setForm({ ...form, staff_id: +e.target.value })} />
                  </Field>
                  <Field label="Sort order">
                    <Input type="number" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: +e.target.value })} />
                  </Field>
                </div>

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

                <div className="flex flex-wrap items-center gap-5 pt-1">
                  <Checkbox label="Offers telehealth" checked={form.telehealth} onChange={(e) => setForm({ ...form, telehealth: e.target.checked })} />
                  <Checkbox label="In-network" checked={form.in_network} onChange={(e) => setForm({ ...form, in_network: e.target.checked })} />
                  <Checkbox label="Active" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
                </div>
              </div>
              <div className="mt-5 flex items-center gap-2">
                <Button onClick={save} loading={saving} disabled={!form.slug.trim() || !form.name.trim()}>
                  {saving ? 'Saving…' : 'Save'}
                </Button>
                <Button variant="secondary" onClick={close}>Cancel</Button>
              </div>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      {!items ? (
        <SkeletonRows rows={6} cols={7} />
      ) : items.length === 0 ? (
        <EmptyState
          title="No clinicians yet"
          description="Add your first clinician to power the match quiz."
          action={<Button onClick={startNew}>＋ Add clinician</Button>}
          icon={<LuUsers width={22} height={22} strokeWidth={1.8} />}
        />
      ) : (
        <TableCard scrollX>
          <THead>
            <tr>
              <TH>Name</TH>
              <TH>Types</TH>
              <TH>Locations</TH>
              <TH>Specialties</TH>
              <TH>Rate</TH>
              <TH>Network</TH>
              <TH>Status</TH>
              <TH>Order</TH>
              <TH>Actions</TH>
            </tr>
          </THead>
          <tbody>
            {items.map((c) => (
              <tr key={c.slug} className={c.active ? undefined : 'opacity-60'}>
                <TD className="whitespace-nowrap">
                  <div className="font-medium text-ink">{c.name}</div>
                  <div className="text-[12px] text-ink-soft">{c.credentials}</div>
                </TD>
                <TD className="text-[12.5px] text-ink-soft">{(c.types ?? []).join(', ') || '—'}</TD>
                <TD className="text-[12.5px] text-ink-soft">
                  {[...(c.locations ?? []), c.telehealth ? 'telehealth' : null].filter(Boolean).join(', ') || '—'}
                </TD>
                <TD className="text-[12.5px] text-ink-soft max-w-[14rem]">{(c.specialties ?? []).join(', ') || '—'}</TD>
                <TD className="whitespace-nowrap text-[12.5px]">{c.rate || '—'}</TD>
                <TD>{c.in_network ? <Pill tone="green">In-network</Pill> : <Pill tone="slate">Out-of-network</Pill>}</TD>
                <TD>{c.active ? <Pill tone="green" dot>Active</Pill> : <Pill tone="slate">Archived</Pill>}</TD>
                <TD className="tabular-nums">{c.sort_order}</TD>
                <TD className="whitespace-nowrap">
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" onClick={() => startEdit(c)}>Edit</Button>
                    {c.active && (
                      <Button variant="ghost" size="sm" onClick={() => archive(c)} className="!text-rose-600 hover:!bg-rose-50">
                        Archive
                      </Button>
                    )}
                  </div>
                </TD>
              </tr>
            ))}
          </tbody>
        </TableCard>
      )}
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
                <div key={oi} className="grid grid-cols-1 items-end gap-2 rounded-lg border border-[#E5E5E5] bg-cream/40 p-2.5 sm:grid-cols-[4.5rem_minmax(8rem,1fr)_minmax(10rem,1.3fr)_minmax(14rem,2fr)_auto]">
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
