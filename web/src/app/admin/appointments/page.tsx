'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { adminFetch, getStoredToken } from '@/components/admin/useAdminAuth';
import {
  PageHeader, PageWrap, TableCard, THead, TH, TD,
  Pill, Pagination, EmptyState, Input, SkeletonRows, Button, ErrorBanner,
} from '@/components/admin/ui';

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
};

type ListResponse = { items: Appointment[]; total: number; page: number; limit: number };

const PAGE_SIZE = 25;

function fmtDateTime(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const d = new Date(t);
  return (
    d.toLocaleString('en-US', {
      timeZone: 'America/Los_Angeles',
      dateStyle: 'medium',
      timeStyle: 'short',
    }) + ' PT'
  );
}

function sourceTone(src: string): 'amber' | 'violet' | 'cyan' | 'blue' | 'slate' {
  if (src === 'chat-agent') return 'amber';
  if (src === 'voice-agent') return 'violet';
  if (src === 'voice-phone') return 'cyan';
  if (src.startsWith('website')) return 'blue';
  return 'slate';
}

function buildQuery(p: {
  page: number; from: string; to: string; source: string; q: string;
}): string {
  const u = new URLSearchParams();
  u.set('page', String(p.page));
  u.set('limit', String(PAGE_SIZE));
  if (p.from) u.set('from', p.from);
  if (p.to) u.set('to', p.to);
  if (p.source && p.source !== 'all') u.set('source', p.source);
  if (p.q.trim()) u.set('q', p.q.trim());
  return u.toString();
}

export default function AdminAppointmentsPage() {
  const [data, setData] = useState<ListResponse | null>(null);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [source, setSource] = useState<'all' | 'chatbot' | 'voice' | 'phone' | 'website'>('all');
  const [q, setQ] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('created_at');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

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
      const r = await adminFetch(`/admin/appointments?${buildQuery({ page, from, to, source, q })}`);
      if (!r.ok) throw new Error(`${r.status}`);
      setData(await r.json());
    } catch {
      setError('Failed to load appointment requests.');
    }
  }, [page, from, to, source, q]);

  // Reset to page 1 when filters change.
  useEffect(() => { setPage(1); }, [from, to, source, q]);

  useEffect(() => { load(); }, [load]);

  const downloadCsv = useCallback(async () => {
    setDownloading(true);
    try {
      const token = getStoredToken();
      const url = `/admin/api/appointments.csv?${buildQuery({ page: 1, from, to, source, q })}`;
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
  }, [from, to, source, q]);

  const items = data?.items ?? [];
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
  const subtitle = useMemo(() => (
    <>Live view of intake submissions from the chatbot and website forms. PHI is fetched from <span className="font-medium text-ink">DynamoDB</span> on demand and every read is recorded in the <span className="font-medium text-ink">PHI access log</span>. §164.312(b)</>
  ), []);

  return (
    <PageWrap max="max-w-7xl">
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

      <div className="mb-4 grid grid-cols-1 gap-3 rounded-xl border border-[#E5E5E5] bg-white p-3 sm:grid-cols-2 lg:grid-cols-5">
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

      {!data && !error ? (
        <SkeletonRows rows={6} cols={9} />
      ) : items.length === 0 ? (
        <EmptyState
          title={from || to || q || source !== 'all' ? 'No appointment requests match these filters' : 'No appointment requests yet'}
          description="Submissions from the chatbot and website intake form will appear here."
          icon={
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <rect x="3" y="4" width="18" height="17" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" />
            </svg>
          }
        />
      ) : (
        <>
          <TableCard>
            <THead>
              <tr>
                <SortableTH label="First Name" col="first_name" sortKey={sortKey} sortDir={sortDir} onClick={() => toggleSort('first_name')} />
                <SortableTH label="Last Name" col="last_name" sortKey={sortKey} sortDir={sortDir} onClick={() => toggleSort('last_name')} />
                <SortableTH label="Date of Birth" col="date_of_birth" sortKey={sortKey} sortDir={sortDir} onClick={() => toggleSort('date_of_birth')} />
                <SortableTH label="Phone Number" col="phone" sortKey={sortKey} sortDir={sortDir} onClick={() => toggleSort('phone')} />
                <SortableTH label="Email Address" col="email" sortKey={sortKey} sortDir={sortDir} onClick={() => toggleSort('email')} />
                <SortableTH label="Home Address" col="home_address" sortKey={sortKey} sortDir={sortDir} onClick={() => toggleSort('home_address')} />
                <SortableTH label="Sex" col="sex" sortKey={sortKey} sortDir={sortDir} onClick={() => toggleSort('sex')} />
                <SortableTH label="Insurance Name" col="insurance_name" sortKey={sortKey} sortDir={sortDir} onClick={() => toggleSort('insurance_name')} />
                <SortableTH label="Insurance ID Number" col="insurance_member_id" sortKey={sortKey} sortDir={sortDir} onClick={() => toggleSort('insurance_member_id')} />
                <TH>Source</TH>
                <SortableTH label="Received" col="created_at" sortKey={sortKey} sortDir={sortDir} onClick={() => toggleSort('created_at')} />
              </tr>
            </THead>
            <motion.tbody initial="initial" animate="animate" variants={{ animate: { transition: { staggerChildren: 0.015 } } }}>
              {sortedItems.map((a) => (
                <motion.tr
                  key={a.id}
                  variants={{ initial: { opacity: 0, y: 4 }, animate: { opacity: 1, y: 0 } }}
                  className="border-t border-slate-100 transition-colors hover:bg-slate-50/70"
                >
                  <TD className="font-medium text-ink">{a.first_name || '—'}</TD>
                  <TD className="font-medium text-ink">{a.last_name || '—'}</TD>
                  <TD className="text-slate-600 tabular-nums">{a.date_of_birth || '—'}</TD>
                  <TD className="text-slate-600 tabular-nums">{a.phone || '—'}</TD>
                  <TD className="text-slate-600">{a.email || '—'}</TD>
                  <TD className="max-w-[220px] truncate text-slate-600">
                    <span title={a.home_address}>{a.home_address || '—'}</span>
                  </TD>
                  <TD className="text-slate-600">{a.sex || '—'}</TD>
                  <TD className="text-slate-600">
                    {a.insurance_name || (a.payment_method === 'self_pay' ? <Pill tone="slate">Self-pay</Pill> : '—')}
                  </TD>
                  <TD className="font-mono text-xs tabular-nums text-slate-600">
                    {a.insurance_member_id || '—'}
                  </TD>
                  <TD>
                    <Pill tone={sourceTone(a.source)} dot>{a.source_label}</Pill>
                  </TD>
                  <TD className="text-xs text-slate-500">
                    <span title={a.created_at}>{fmtDateTime(a.created_at)}</span>
                  </TD>
                </motion.tr>
              ))}
            </motion.tbody>
          </TableCard>
          <Pagination page={page} total={data!.total} pageSize={PAGE_SIZE} onChange={setPage} />
        </>
      )}
    </PageWrap>
  );
}

function SortableTH({
  label, col, sortKey, sortDir, onClick,
}: {
  label: string;
  col: SortKey;
  sortKey: SortKey;
  sortDir: SortDir;
  onClick: () => void;
}) {
  const active = col === sortKey;
  const arrow = active ? (sortDir === 'asc' ? '▲' : '▼') : '⇅';
  return (
    <TH>
      <button
        type="button"
        onClick={onClick}
        className="inline-flex items-center gap-1 hover:text-ink"
        aria-label={`Sort by ${label}`}
      >
        {label}
        <span className={active ? 'text-brand' : 'text-slate-300'}>{arrow}</span>
      </button>
    </TH>
  );
}
