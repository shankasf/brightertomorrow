'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { adminFetch, getStoredToken } from '@/components/admin/useAdminAuth';
import {
  PageHeader, PageWrap, TableCard, THead, TH, TD,
  Pill, Pagination, EmptyState, Input, SkeletonRows, Button, ErrorBanner,
} from '@/components/admin/ui';
import { formatPT } from '@/lib/time-pt';
import { LuCalendar, LuChevronDown } from 'react-icons/lu';

type SortKey =
  | 'first_name'
  | 'last_name'
  | 'date_of_birth'
  | 'phone'
  | 'email'
  | 'home_address'
  | 'sex'
  | 'insurance_name'
  | 'insurance_member_id'
  | 'created_at';
type SortDir = 'asc' | 'desc';

type Appointment = {
  id: number;
  submission_uuid: string;
  created_at: string;
  source: string;
  source_label: string;
  flow: string;
  status: string;
  payment_method: string;
  first_name: string;
  last_name: string;
  date_of_birth: string;
  phone: string;
  email: string;
  home_address: string;
  sex: string;
  insurance_name: string;
  insurance_member_id: string;
  workflow_status: string;
  email_hash: string;
};

type ListResponse = { items: Appointment[]; total: number; page: number; limit: number };

type StatusMutationResponse = {
  updated: number;
  failed: { submission_uuid: string; error: string }[];
  notified: number;
};

const PAGE_SIZE = 25;

// ── Workflow status metadata ──────────────────────────────────────────────
type WorkflowStatus =
  | 'new'
  | 'in_review'
  | 'approved'
  | 'scheduled'
  | 'reschedule_requested'
  | 'cancel_requested'
  | 'cancelled'
  | 'no_show'
  | 'completed'
  | 'rejected'
  | 'archived';

type PillTone = 'green' | 'amber' | 'red' | 'blue' | 'slate' | 'violet' | 'cyan' | 'brand' | 'wine';

const STATUS_META: Record<WorkflowStatus, { label: string; tone: PillTone }> = {
  new: { label: 'New', tone: 'slate' },
  in_review: { label: 'In review', tone: 'blue' },
  approved: { label: 'Approved', tone: 'green' },
  scheduled: { label: 'Scheduled', tone: 'violet' },
  reschedule_requested: { label: 'Reschedule req.', tone: 'amber' },
  cancel_requested: { label: 'Cancellation req.', tone: 'amber' },
  cancelled: { label: 'Cancelled', tone: 'slate' },
  no_show: { label: 'No-show', tone: 'slate' },
  completed: { label: 'Completed', tone: 'cyan' },
  rejected: { label: 'Rejected', tone: 'slate' },
  archived: { label: 'Archived', tone: 'slate' },
};

const STATUS_ORDER: WorkflowStatus[] = [
  'new', 'in_review', 'approved', 'scheduled', 'reschedule_requested',
  'cancel_requested', 'cancelled', 'no_show', 'completed', 'rejected', 'archived',
];

// Statuses that should trigger a patient notification when set.
const NOTIFY_STATUSES: ReadonlySet<string> = new Set([
  'approved', 'scheduled', 'cancelled', 'reschedule_requested', 'cancel_requested', 'completed',
]);

// Statuses that read as destructive/irreversible — get a red confirm button.
const DANGER_STATUSES: ReadonlySet<string> = new Set(['archived', 'cancelled', 'rejected']);

// A pending confirmation for a status change (inline single row or bulk).
type ConfirmState = {
  title: string;
  message: string;
  confirmLabel: string;
  tone: 'primary' | 'danger';
  run: () => Promise<void>;
};

function normalizeStatus(s: string | undefined | null): WorkflowStatus {
  return s && s in STATUS_META ? (s as WorkflowStatus) : 'new';
}

// Status filter: 'active' is the default (no param → server hides archived).
type StatusFilter = 'active' | 'all' | WorkflowStatus;

function fmtDateTime(iso: string): string {
  return formatPT(iso);
}

function sourceTone(src: string): 'amber' | 'violet' | 'cyan' | 'blue' | 'slate' {
  if (src === 'chat-agent') return 'amber';
  if (src === 'voice-agent') return 'violet';
  if (src === 'voice-phone') return 'cyan';
  if (src.startsWith('website')) return 'blue';
  return 'slate';
}

function buildQuery(p: {
  page: number; from: string; to: string; source: string; q: string; status: StatusFilter;
}): string {
  const u = new URLSearchParams();
  u.set('page', String(p.page));
  u.set('limit', String(PAGE_SIZE));
  if (p.from) u.set('from', p.from);
  if (p.to) u.set('to', p.to);
  if (p.source && p.source !== 'all') u.set('source', p.source);
  if (p.q.trim()) u.set('q', p.q.trim());
  // 'active' is the default — send no workflow_status so the server hides archived.
  if (p.status === 'all') u.set('workflow_status', 'all');
  else if (p.status !== 'active') u.set('workflow_status', p.status);
  return u.toString();
}

export default function AdminAppointmentsPage() {
  const [data, setData] = useState<ListResponse | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [page, setPage] = useState(1);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [source, setSource] = useState<'all' | 'chatbot' | 'voice' | 'phone' | 'website'>('all');
  const [status, setStatus] = useState<StatusFilter>('active');
  const [q, setQ] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('created_at');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [pending, setPending] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  const load = useCallback(async () => {
    setData(null);
    setError('');
    try {
      const r = await adminFetch(`/admin/appointments?${buildQuery({ page, from, to, source, q, status })}`);
      if (!r.ok) throw new Error(`${r.status}`);
      setData(await r.json());
    } catch {
      setError('Failed to load appointment requests.');
    }
  }, [page, from, to, source, q, status]);

  // Reset to page 1 when filters change.
  useEffect(() => { setPage(1); }, [from, to, source, q, status]);

  useEffect(() => { load(); }, [load]);

  // Drop any selection that no longer exists in the current page.
  useEffect(() => {
    if (selected.size === 0) return;
    const ids = new Set((data?.items ?? []).map((a) => a.id));
    setSelected((prev) => {
      const next = new Set([...prev].filter((id) => ids.has(id)));
      return next.size === prev.size ? prev : next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const downloadCsv = useCallback(async () => {
    setDownloading(true);
    try {
      const token = getStoredToken();
      const url = `/admin/api/appointments.csv?${buildQuery({ page: 1, from, to, source, q, status })}`;
      const r = await fetch(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!r.ok) throw new Error(`${r.status}`);
      const blob = await r.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      const stamp = new Date().toISOString().slice(0, 10);
      a.download = `appointments-${stamp}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(a.href);
    } catch {
      setError('CSV export failed.');
    } finally {
      setDownloading(false);
    }
  }, [from, to, source, q, status]);

  // POST the status mutation for a set of rows. Returns the parsed response.
  const postStatus = useCallback(
    async (rows: Appointment[], next: WorkflowStatus, notify: boolean): Promise<StatusMutationResponse> => {
      const r = await adminFetch('/admin/api/appointments/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: next,
          notify,
          items: rows.map((a) => ({ submission_uuid: a.submission_uuid, email_hash: a.email_hash })),
        }),
      });
      if (!r.ok) throw new Error(`${r.status}`);
      return (await r.json()) as StatusMutationResponse;
    },
    [],
  );

  // The actual single-row mutation: optimistic update + revert on failure.
  const doRowStatus = useCallback(
    async (row: Appointment, prev: WorkflowStatus, next: WorkflowStatus) => {
      const notify = NOTIFY_STATUSES.has(next);
      setError('');
      setNotice('');
      setPending(true);
      // Optimistic update.
      setData((d) => d && {
        ...d,
        items: d.items.map((a) => (a.id === row.id ? { ...a, workflow_status: next } : a)),
      });
      try {
        const res = await postStatus([row], next, notify);
        const failed = res.failed ?? [];
        if (failed.length > 0) throw new Error(failed[0]?.error || 'update failed');
        if (notify && res.notified > 0) setNotice('Status updated and the patient was notified.');
      } catch {
        // Revert.
        setData((d) => d && {
          ...d,
          items: d.items.map((a) => (a.id === row.id ? { ...a, workflow_status: prev } : a)),
        });
        setError('Could not update the status. Please try again.');
      } finally {
        setPending(false);
      }
    },
    [postStatus],
  );

  // Inline single-row change — opens a confirmation first.
  const requestRowStatus = useCallback(
    (row: Appointment, next: WorkflowStatus) => {
      if (pending) return;
      const prev = normalizeStatus(row.workflow_status);
      if (next === prev) return;
      const name = [row.first_name, row.last_name].filter(Boolean).join(' ') || 'this request';
      setConfirm({
        title: next === 'archived' ? 'Archive request?' : 'Change status?',
        message: `Change ${name} from “${STATUS_META[prev].label}” to “${STATUS_META[next].label}”?`,
        confirmLabel: next === 'archived' ? 'Archive' : 'Change status',
        tone: DANGER_STATUSES.has(next) ? 'danger' : 'primary',
        run: () => doRowStatus(row, prev, next),
      });
    },
    [pending, doRowStatus],
  );

  const items = data?.items ?? [];

  // The actual bulk mutation over a fixed row set.
  const doBulkStatus = useCallback(
    async (rows: Appointment[], next: WorkflowStatus) => {
      const notify = NOTIFY_STATUSES.has(next);
      setError('');
      setNotice('');
      setPending(true);
      try {
        const res = await postStatus(rows, next, notify);
        const failed = res.failed ?? [];
        if (failed.length > 0) {
          setNotice(`Updated ${res.updated}, ${failed.length} failed.`);
        } else {
          const notifyNote = notify && res.notified > 0 ? ` ${res.notified} notified.` : '';
          setNotice(`Updated ${res.updated} request${res.updated === 1 ? '' : 's'}.${notifyNote}`);
        }
        setSelected(new Set());
        await load();
      } catch {
        setError('Bulk update failed. No changes were applied.');
      } finally {
        setPending(false);
      }
    },
    [postStatus, load],
  );

  // Bulk action over the current selection — opens a confirmation first.
  const requestBulkStatus = useCallback(
    (next: WorkflowStatus) => {
      const rows = items.filter((a) => selected.has(a.id));
      if (rows.length === 0 || pending) return;
      const n = rows.length;
      const verb = next === 'archived' ? 'Archive' : `Set status to “${STATUS_META[next].label}” for`;
      setConfirm({
        title: next === 'archived' ? 'Archive requests?' : 'Update status?',
        message: `${verb} ${n} selected request${n === 1 ? '' : 's'}?`,
        confirmLabel: next === 'archived' ? `Archive ${n}` : `Update ${n}`,
        tone: DANGER_STATUSES.has(next) ? 'danger' : 'primary',
        run: () => doBulkStatus(rows, next),
      });
    },
    [items, selected, pending, doBulkStatus],
  );

  // Run the pending confirmation's action, keeping the dialog open (busy) until done.
  const runConfirm = useCallback(async () => {
    if (!confirm) return;
    await confirm.run();
    setConfirm(null);
  }, [confirm]);

  const sortedItems = useMemo(() => {
    const list = [...items];
    list.sort((a, b) => {
      const av = (a[sortKey] ?? '').toString().toLowerCase();
      const bv = (b[sortKey] ?? '').toString().toLowerCase();
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return list;
  }, [items, sortKey, sortDir]);

  const allOnPageSelected = items.length > 0 && items.every((a) => selected.has(a.id));
  const someOnPageSelected = items.some((a) => selected.has(a.id));

  const toggleSelectAll = useCallback(() => {
    setSelected((prev) => {
      if (items.length > 0 && items.every((a) => prev.has(a.id))) return new Set();
      return new Set(items.map((a) => a.id));
    });
  }, [items]);

  const toggleRow = useCallback((id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const subtitle = useMemo(() => (
    <>Live view of intake submissions from the chatbot and website forms. PHI is fetched from <span className="font-medium text-ink">DynamoDB</span> on demand and every read is recorded in the <span className="font-medium text-ink">PHI access log</span>. §164.312(b)</>
  ), []);

  return (
    <PageWrap max="max-w-none">
      <PageHeader
        title="Appointment requests"
        subtitle={subtitle}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={downloadCsv} disabled={downloading}>
              {downloading ? 'Preparing…' : 'Download CSV'}
            </Button>
          </div>
        }
      />

      {error && <ErrorBanner>{error}</ErrorBanner>}
      {notice && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          role="status"
          aria-live="polite"
          className="mb-4 rounded-xl border border-emerald-200/70 bg-emerald-50/80 px-4 py-3 text-sm text-emerald-800"
        >
          {notice}
        </motion.div>
      )}

      <div className="mb-4 grid grid-cols-1 gap-3 rounded-xl border border-[#E5E5E5] bg-white p-3 sm:grid-cols-2 lg:grid-cols-6">
        <label className="flex flex-col text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-soft">
          From
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="!mt-1" />
        </label>
        <label className="flex flex-col text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-soft">
          To
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="!mt-1" />
        </label>
        <label className="flex flex-col text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-soft">
          Source
          <select
            value={source}
            onChange={(e) => setSource(e.target.value as 'all' | 'chatbot' | 'voice' | 'phone' | 'website')}
            className="mt-1 h-9 rounded-md border border-slate-200 bg-white px-2 text-sm text-ink focus:border-brand focus:outline-none"
          >
            <option value="all">All sources</option>
            <option value="chatbot">Chatbot</option>
            <option value="voice">Voice (any)</option>
            <option value="phone">Voice (phone only)</option>
            <option value="website">Website form</option>
          </select>
        </label>
        <label className="flex flex-col text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-soft">
          Status
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as StatusFilter)}
            className="mt-1 h-9 rounded-md border border-slate-200 bg-white px-2 text-sm text-ink focus:border-brand focus:outline-none"
          >
            <option value="active">Active (default)</option>
            {STATUS_ORDER.filter((s) => s !== 'archived').map((s) => (
              <option key={s} value={s}>{STATUS_META[s].label}</option>
            ))}
            <option value="archived">Archived</option>
            <option value="all">All (incl. archived)</option>
          </select>
        </label>
        <label className="flex flex-col text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-soft sm:col-span-2">
          Search (name, email, phone)
          <Input
            placeholder="e.g. Maria, jdoe@…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="!mt-1"
          />
        </label>
      </div>

      {/* Bulk action toolbar */}
      <AnimatePresence>
        {selected.size > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18 }}
            className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-[#E5E5E5] bg-white p-3 shadow-sm"
          >
            <span className="text-sm font-medium text-ink">
              {selected.size} selected
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label="Set status for selected requests"
                value=""
                disabled={pending}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v) requestBulkStatus(v as WorkflowStatus);
                  e.currentTarget.value = '';
                }}
                className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm text-ink focus:border-brand focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="">Set status to…</option>
                {STATUS_ORDER.filter((s) => s !== 'archived').map((s) => (
                  <option key={s} value={s}>{STATUS_META[s].label}</option>
                ))}
              </select>
              <Button
                variant="danger"
                size="sm"
                loading={pending}
                disabled={pending}
                onClick={() => requestBulkStatus('archived')}
              >
                Archive
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() => setSelected(new Set())}
              >
                Clear
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {!data && !error ? (
        <SkeletonRows rows={6} cols={11} />
      ) : items.length === 0 ? (
        <EmptyState
          title={from || to || q || source !== 'all' || status !== 'active' ? 'No appointment requests match these filters' : 'No appointment requests yet'}
          description="Submissions from the chatbot and website intake form will appear here."
          icon={<LuCalendar width={22} height={22} strokeWidth={1.8} />}
        />
      ) : (
        <>
          <TableCard scrollX>
            <THead>
              <tr>
                <TH className="w-9">
                  <input
                    type="checkbox"
                    aria-label="Select all on this page"
                    checked={allOnPageSelected}
                    ref={(el) => { if (el) el.indeterminate = !allOnPageSelected && someOnPageSelected; }}
                    onChange={toggleSelectAll}
                    className="h-4 w-4 rounded border-[#D9D9D9] text-brand-600 focus:ring-brand/40"
                  />
                </TH>
                <SortableTH label="Name" col="last_name" sortKey={sortKey} sortDir={sortDir} onClick={() => toggleSort('last_name')} />
                <TH>Status</TH>
                <SortableTH label="Phone" col="phone" sortKey={sortKey} sortDir={sortDir} onClick={() => toggleSort('phone')} />
                <SortableTH label="DOB" col="date_of_birth" sortKey={sortKey} sortDir={sortDir} onClick={() => toggleSort('date_of_birth')} />
                <SortableTH label="Email" col="email" sortKey={sortKey} sortDir={sortDir} onClick={() => toggleSort('email')} />
                <SortableTH label="Address" col="home_address" sortKey={sortKey} sortDir={sortDir} onClick={() => toggleSort('home_address')} />
                <SortableTH label="Sex" col="sex" sortKey={sortKey} sortDir={sortDir} onClick={() => toggleSort('sex')} />
                <SortableTH label="Insurance" col="insurance_name" sortKey={sortKey} sortDir={sortDir} onClick={() => toggleSort('insurance_name')} />
                <SortableTH label="Member ID" col="insurance_member_id" sortKey={sortKey} sortDir={sortDir} onClick={() => toggleSort('insurance_member_id')} />
                <TH>Source</TH>
                <SortableTH label="Received" col="created_at" sortKey={sortKey} sortDir={sortDir} onClick={() => toggleSort('created_at')} />
              </tr>
            </THead>
            <motion.tbody initial="initial" animate="animate" variants={{ animate: { transition: { staggerChildren: 0.015 } } }}>
              {sortedItems.map((a) => {
                const fullName = [a.first_name, a.last_name].filter(Boolean).join(' ') || '—';
                const ws = normalizeStatus(a.workflow_status);
                const isSelected = selected.has(a.id);
                return (
                <motion.tr
                  key={a.id}
                  variants={{ initial: { opacity: 0, y: 4 }, animate: { opacity: 1, y: 0 } }}
                  className={isSelected ? 'bg-brand-50/40' : undefined}
                >
                  <TD className="w-9">
                    <input
                      type="checkbox"
                      aria-label={`Select ${fullName}`}
                      checked={isSelected}
                      onChange={() => toggleRow(a.id)}
                      className="h-4 w-4 rounded border-[#D9D9D9] text-brand-600 focus:ring-brand/40"
                    />
                  </TD>
                  <TD className="whitespace-nowrap">{fullName}</TD>
                  <TD>
                    <StatusCell status={ws} disabled={pending} onChange={(next) => requestRowStatus(a, next)} />
                  </TD>
                  <TD className="tabular-nums whitespace-nowrap">{a.phone || '—'}</TD>
                  <TD className="tabular-nums whitespace-nowrap">{a.date_of_birth || '—'}</TD>
                  <TD className="whitespace-nowrap">{a.email || '—'}</TD>
                  <TD className="whitespace-nowrap" title={a.home_address}>{a.home_address || '—'}</TD>
                  <TD className="whitespace-nowrap">{a.sex || '—'}</TD>
                  <TD className="whitespace-nowrap">
                    {a.insurance_name || (a.payment_method === 'self_pay' ? <Pill tone="slate">Self-pay</Pill> : '—')}
                  </TD>
                  <TD className="whitespace-nowrap font-mono text-[12.5px] tabular-nums">
                    {a.insurance_member_id || '—'}
                  </TD>
                  <TD>
                    <Pill tone={sourceTone(a.source)} dot>{a.source_label}</Pill>
                  </TD>
                  <TD className="whitespace-nowrap text-[12.5px] text-ink-soft" title={a.created_at}>
                    {fmtDateTime(a.created_at)}
                  </TD>
                </motion.tr>
                );
              })}
            </motion.tbody>
          </TableCard>
          <Pagination page={page} total={data!.total} pageSize={PAGE_SIZE} onChange={setPage} />
        </>
      )}

      <ConfirmDialog
        state={confirm}
        busy={pending}
        onConfirm={runConfirm}
        onCancel={() => { if (!pending) setConfirm(null); }}
      />
    </PageWrap>
  );
}

// Modal confirmation for status changes (inline + bulk). Accessible: role=dialog,
// Escape to cancel, backdrop click to cancel, confirm button auto-focused.
function ConfirmDialog({
  state,
  busy,
  onConfirm,
  onCancel,
}: {
  state: ConfirmState | null;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    if (!state) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state, busy, onCancel]);

  return (
    <AnimatePresence>
      {state && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.14 }}
        >
          <div
            className="absolute inset-0 bg-ink/30 backdrop-blur-[1px]"
            onClick={() => { if (!busy) onCancel(); }}
            aria-hidden
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="appt-confirm-title"
            initial={{ opacity: 0, scale: 0.97, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 6 }}
            transition={{ duration: 0.16 }}
            className="relative w-full max-w-md rounded-2xl border border-[#E5E5E5] bg-white p-5 shadow-xl"
          >
            <h2 id="appt-confirm-title" className="text-base font-semibold text-ink">{state.title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-ink-soft">{state.message}</p>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" size="sm" disabled={busy} onClick={onCancel}>Cancel</Button>
              <Button
                variant={state.tone === 'danger' ? 'danger' : 'primary'}
                size="sm"
                loading={busy}
                disabled={busy}
                autoFocus
                onClick={onConfirm}
              >
                {state.confirmLabel}
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// Interactive status cell: a Pill that becomes editable on click via a native
// <select> overlay (accessible, keyboard-friendly). Non-archive changes apply
// immediately; the parent handles optimistic update + confirm-for-archive.
function StatusCell({
  status,
  disabled,
  onChange,
}: {
  status: WorkflowStatus;
  disabled: boolean;
  onChange: (next: WorkflowStatus) => void;
}) {
  const [editing, setEditing] = useState(false);
  const meta = STATUS_META[status];

  if (editing) {
    return (
      <select
        autoFocus
        aria-label="Change status"
        value={status}
        disabled={disabled}
        onChange={(e) => {
          const next = e.target.value as WorkflowStatus;
          setEditing(false);
          if (next !== status) onChange(next);
        }}
        onBlur={() => setEditing(false)}
        className="h-8 rounded-lg border border-slate-300 bg-white px-2 text-[12.5px] text-ink shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {STATUS_ORDER.map((s) => (
          <option key={s} value={s}>{STATUS_META[s].label}</option>
        ))}
      </select>
    );
  }

  return (
    <button
      type="button"
      disabled={disabled}
      aria-haspopup="listbox"
      aria-label={`Status: ${meta.label}. Click to change.`}
      onClick={() => setEditing(true)}
      className="group inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white py-1 pl-1.5 pr-1.5 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <Pill tone={meta.tone}>{meta.label}</Pill>
      <LuChevronDown className="h-3.5 w-3.5 shrink-0 text-ink-faint transition-colors group-hover:text-ink-soft" strokeWidth={2.2} />
    </button>
  );
}

function SortableTH({
  label, col, sortKey, sortDir, onClick, className,
}: {
  label: string;
  col: SortKey;
  sortKey: SortKey;
  sortDir: SortDir;
  onClick: () => void;
  className?: string;
}) {
  const active = col === sortKey;
  const arrow = active ? (sortDir === 'asc' ? '▲' : '▼') : '⇅';
  return (
    <TH className={className}>
      <button
        type="button"
        onClick={onClick}
        className="inline-flex items-center gap-1 transition-colors hover:text-brand-700"
        aria-label={`Sort by ${label}`}
      >
        {label}
        <span className={active ? 'text-brand-700' : 'text-ink-faint'}>{arrow}</span>
      </button>
    </TH>
  );
}
