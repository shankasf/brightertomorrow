'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { adminFetch } from '@/components/admin/useAdminAuth';
import {
  PageHeader, PageWrap, TableCard, THead, TH, TD,
  Pill, Pagination, EmptyState, Input, SkeletonRows, ErrorBanner,
} from '@/components/admin/ui';
import { formatPT } from '@/lib/time-pt';
import { LuPhone } from 'react-icons/lu';

type CallbackRow = {
  id: number;
  first_name: string;
  last_name: string;
  phone: string;
  reason: string;
  source: string;
  created_at: string;
};

type ListResponse = { items: CallbackRow[]; total: number; page: number; limit: number };

const PAGE_SIZE = 25;

type SortKey = 'first_name' | 'last_name' | 'phone' | 'reason' | 'source' | 'created_at';
type SortDir = 'asc' | 'desc';

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

function sourceLabel(src: string): string {
  if (src === 'chat-agent') return 'Chatbot';
  if (src === 'voice-agent') return 'Voice (web)';
  if (src === 'voice-phone') return 'Voice (phone)';
  if (src === 'website') return 'Website';
  return src || '—';
}

function buildQuery(p: { page: number; source: string; q: string }): string {
  const u = new URLSearchParams();
  u.set('page', String(p.page));
  u.set('limit', String(PAGE_SIZE));
  if (p.source && p.source !== 'all') u.set('source', p.source);
  if (p.q.trim()) u.set('q', p.q.trim());
  return u.toString();
}

export default function AdminCallbacksPage() {
  const [data, setData] = useState<ListResponse | null>(null);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  // Only AI agents write to bt.callback_requests (via /internal/callback/submit),
  // so source values are limited to chat-agent / voice-agent / voice-phone.
  // The old "website" option was dead UI — no public website callback form exists.
  const [source, setSource] = useState<'all' | 'chat-agent' | 'voice-agent' | 'voice-phone'>('all');
  const [q, setQ] = useState('');
  // Debounce the search box so each keystroke doesn't refetch (and re-audit)
  // PHI rows. 250ms matches the activity-log page.
  const [debouncedQ, setDebouncedQ] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  const [sortKey, setSortKey] = useState<SortKey>('created_at');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const load = useCallback(async () => {
    setData(null);
    setError('');
    try {
      const r = await adminFetch(`/admin/callbacks?${buildQuery({ page, source, q: debouncedQ })}`);
      if (!r.ok) throw new Error(`${r.status}`);
      setData(await r.json());
    } catch {
      setError('Failed to load callback requests.');
    }
  }, [page, source, debouncedQ]);

  useEffect(() => { setPage(1); }, [source, debouncedQ]);
  useEffect(() => { load(); }, [load]);

  const items = data?.items ?? [];

  const sorted = useMemo(() => {
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

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  const subtitle = useMemo(() => (
    <>
      Visitors who asked to be phoned back. Just first name, last name, phone, and a one-line reason —
      <span className="font-medium text-ink"> not</span> appointment bookings. Each list view writes a
      row per request to the <span className="font-medium text-ink">PHI access log</span>. §164.312(b)
    </>
  ), []);

  return (
    <PageWrap max="max-w-6xl">
      <PageHeader title="Callback requests — Chatbot" subtitle={subtitle} />

      {error && <ErrorBanner>{error}</ErrorBanner>}

      <div className="mb-4 grid grid-cols-1 gap-3 rounded-xl border border-[#E5E5E5] bg-white p-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="flex flex-col text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-soft">
          Source
          <select
            value={source}
            onChange={(e) => setSource(e.target.value as 'all' | 'chat-agent' | 'voice-agent' | 'voice-phone')}
            className="mt-1 h-9 rounded-md border border-slate-200 bg-white px-2 text-sm text-ink focus:border-brand focus:outline-none"
          >
            <option value="all">All sources</option>
            <option value="chat-agent">Chatbot</option>
            <option value="voice-agent">Voice (web)</option>
            <option value="voice-phone">Voice (phone)</option>
          </select>
        </label>
        <label className="flex flex-col text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-soft sm:col-span-2">
          Search (name, phone, reason)
          <Input
            placeholder="e.g. Maria, anxiety, 555…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="!mt-1"
          />
        </label>
      </div>

      {!data && !error ? (
        <SkeletonRows rows={6} cols={6} />
      ) : items.length === 0 ? (
        <EmptyState
          title={q || source !== 'all' ? 'No callback requests match these filters' : 'No callback requests yet'}
          description="Visitors who ask to be phoned back from the chatbot or voice agent show up here."
          icon={<LuPhone width={22} height={22} strokeWidth={1.8} />}
        />
      ) : (
        <>
          <TableCard>
            <THead>
              <tr>
                <SortableTH label="Name" col="last_name" sortKey={sortKey} sortDir={sortDir} onClick={() => toggleSort('last_name')} />
                <SortableTH label="Phone" col="phone" sortKey={sortKey} sortDir={sortDir} onClick={() => toggleSort('phone')} />
                <SortableTH label="Reason" col="reason" sortKey={sortKey} sortDir={sortDir} onClick={() => toggleSort('reason')} className="bt-col-hide-md" />
                <SortableTH label="Source" col="source" sortKey={sortKey} sortDir={sortDir} onClick={() => toggleSort('source')} className="bt-col-hide-sm" />
                <SortableTH label="Submitted" col="created_at" sortKey={sortKey} sortDir={sortDir} onClick={() => toggleSort('created_at')} className="bt-col-hide-lg" />
              </tr>
            </THead>
            <motion.tbody initial="initial" animate="animate" variants={{ animate: { transition: { staggerChildren: 0.015 } } }}>
              {sorted.map((c) => {
                const fullName = [c.first_name, c.last_name].filter(Boolean).join(' ') || '—';
                return (
                <motion.tr
                  key={c.id}
                  variants={{ initial: { opacity: 0, y: 4 }, animate: { opacity: 1, y: 0 } }}
                >
                  <TD>{fullName}</TD>
                  <TD className="tabular-nums whitespace-nowrap">{c.phone}</TD>
                  <TD className="bt-col-hide-md max-w-[420px] truncate" title={c.reason}>{c.reason}</TD>
                  <TD className="bt-col-hide-sm">
                    <Pill tone={sourceTone(c.source)} dot>{sourceLabel(c.source)}</Pill>
                  </TD>
                  <TD className="bt-col-hide-lg whitespace-nowrap text-[12.5px] text-ink-soft" title={c.created_at}>
                    {fmtDateTime(c.created_at)}
                  </TD>
                </motion.tr>
                );
              })}
            </motion.tbody>
          </TableCard>
          <Pagination page={page} total={data!.total} pageSize={PAGE_SIZE} onChange={setPage} />
        </>
      )}
    </PageWrap>
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
