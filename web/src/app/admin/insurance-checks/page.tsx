'use client';
import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { adminFetch, getStoredToken } from '@/components/admin/useAdminAuth';
import {
  PageHeader, PageWrap, TableCard, THead, TH, TD,
  Pill, Pagination, EmptyState, Input, SkeletonRows, Button, ErrorBanner,
} from '@/components/admin/ui';

type Check = {
  id: number;
  check_uuid: string;
  submission_uuid?: string;
  created_at: string;
  source: string;
  source_label: string;
  payer_name: string;
  coverage_status: string;
  eligible: boolean;
  first_name?: string;
  last_name?: string;
  date_of_birth?: string;
  phone?: string;
  email?: string;
  insurance_member_id?: string;
};

type ListResponse = { items: Check[]; total: number; page: number; limit: number };

const PAGE_SIZE = 25;

function fmtDateTime(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  return new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function statusTone(s: string): 'green' | 'amber' | 'red' | 'slate' {
  if (s === 'eligible') return 'green';
  if (s === 'ineligible' || s === 'verification_error') return 'red';
  if (s === 'needs_review') return 'amber';
  return 'slate';
}

function sourceTone(s: string): 'amber' | 'violet' | 'blue' | 'slate' {
  if (s === 'chat-agent') return 'amber';
  if (s === 'voice-agent') return 'violet';
  if (s.startsWith('website')) return 'blue';
  return 'slate';
}

function buildQuery(p: {
  page: number; from: string; to: string; source: string; status: string; q: string;
}): string {
  const u = new URLSearchParams();
  u.set('page', String(p.page));
  u.set('limit', String(PAGE_SIZE));
  if (p.from) u.set('from', p.from);
  if (p.to) u.set('to', p.to);
  if (p.source && p.source !== 'all') u.set('source', p.source);
  if (p.status && p.status !== 'all') u.set('status', p.status);
  if (p.q.trim()) u.set('q', p.q.trim());
  return u.toString();
}

export default function AdminInsuranceChecksPage() {
  const [data, setData] = useState<ListResponse | null>(null);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [source, setSource] = useState<'all' | 'chatbot' | 'voice' | 'website'>('all');
  const [status, setStatus] = useState<'all' | 'eligible' | 'ineligible' | 'needs_review' | 'verification_error'>('all');
  const [q, setQ] = useState('');
  const [downloading, setDownloading] = useState(false);

  const load = useCallback(async () => {
    setData(null);
    setError('');
    try {
      const r = await adminFetch(`/admin/insurance-checks?${buildQuery({ page, from, to, source, status, q })}`);
      if (!r.ok) throw new Error(`${r.status}`);
      setData(await r.json());
    } catch {
      setError('Failed to load insurance check history.');
    }
  }, [page, from, to, source, status, q]);

  useEffect(() => { setPage(1); }, [from, to, source, status, q]);
  useEffect(() => { load(); }, [load]);

  const downloadCsv = useCallback(async () => {
    setDownloading(true);
    try {
      const token = getStoredToken();
      const url = `/admin/api/insurance-checks.csv?${buildQuery({ page: 1, from, to, source, status, q })}`;
      const r = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!r.ok) throw new Error(`${r.status}`);
      const blob = await r.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `insurance-checks-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(a.href);
    } catch {
      setError('CSV export failed.');
    } finally {
      setDownloading(false);
    }
  }, [from, to, source, status, q]);

  const items = data?.items ?? [];

  return (
    <PageWrap max="max-w-7xl">
      <PageHeader
        title="Insurance check history"
        subtitle={
          <>
            Every CLAIM.MD eligibility verification — voice, chatbot, and website
            — recorded with who, when, and the result. PHI is fetched from{' '}
            <span className="font-medium text-ink">DynamoDB</span> on demand and
            every read is logged in the <span className="font-medium text-ink">PHI access log</span>. §164.312(b)
          </>
        }
        action={
          <Button onClick={downloadCsv} disabled={downloading}>
            {downloading ? 'Preparing…' : 'Download CSV'}
          </Button>
        }
      />

      {error && <ErrorBanner>{error}</ErrorBanner>}

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
            onChange={(e) => setSource(e.target.value as typeof source)}
            className="mt-1 h-9 rounded-md border border-slate-200 bg-white px-2 text-sm text-ink focus:border-brand focus:outline-none"
          >
            <option value="all">All sources</option>
            <option value="chatbot">Chatbot</option>
            <option value="voice">Voice</option>
            <option value="website">Website form</option>
          </select>
        </label>
        <label className="flex flex-col text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-soft">
          Status
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as typeof status)}
            className="mt-1 h-9 rounded-md border border-slate-200 bg-white px-2 text-sm text-ink focus:border-brand focus:outline-none"
          >
            <option value="all">All statuses</option>
            <option value="eligible">Eligible</option>
            <option value="ineligible">Ineligible</option>
            <option value="needs_review">Needs review</option>
            <option value="verification_error">Verification error</option>
          </select>
        </label>
        <label className="flex flex-col text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-soft sm:col-span-2">
          Search (name, email, phone, payer)
          <Input value={q} onChange={(e) => setQ(e.target.value)} className="!mt-1" />
        </label>
      </div>

      {!data && !error ? (
        <SkeletonRows rows={6} cols={8} />
      ) : items.length === 0 ? (
        <EmptyState
          title={from || to || q || source !== 'all' || status !== 'all' ? 'No insurance checks match these filters' : 'No insurance checks yet'}
          description="Eligibility verifications from the chatbot, voice agent, and website intake will appear here."
          icon={
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M12 3 4 6v6c0 5 3.5 8.5 8 9 4.5-.5 8-4 8-9V6z" /><path d="m9 12 2 2 4-4" />
            </svg>
          }
        />
      ) : (
        <>
          <TableCard>
            <THead>
              <tr>
                <TH>Patient</TH>
                <TH>DOB</TH>
                <TH>Phone</TH>
                <TH>Email</TH>
                <TH>Insurance</TH>
                <TH>Status</TH>
                <TH>Source</TH>
                <TH>Checked At</TH>
              </tr>
            </THead>
            <motion.tbody initial="initial" animate="animate" variants={{ animate: { transition: { staggerChildren: 0.015 } } }}>
              {items.map((c) => {
                const fullName = [c.first_name, c.last_name].filter(Boolean).join(' ');
                return (
                  <motion.tr
                    key={c.id}
                    variants={{ initial: { opacity: 0, y: 4 }, animate: { opacity: 1, y: 0 } }}
                    className="border-t border-slate-100 transition-colors hover:bg-slate-50/70"
                  >
                    <TD>
                      <div className="font-medium text-ink">{fullName || <span className="text-slate-400">—</span>}</div>
                    </TD>
                    <TD className="text-slate-600 tabular-nums">{c.date_of_birth || '—'}</TD>
                    <TD className="text-slate-600 tabular-nums">{c.phone || '—'}</TD>
                    <TD className="text-slate-600">{c.email || '—'}</TD>
                    <TD>
                      <div className="font-medium text-ink">{c.payer_name || '—'}</div>
                      {c.insurance_member_id && (
                        <div className="text-[11px] font-mono tabular-nums text-slate-400">
                          ID {c.insurance_member_id}
                        </div>
                      )}
                    </TD>
                    <TD>
                      <Pill tone={statusTone(c.coverage_status)} dot>
                        {c.eligible ? 'Eligible' : c.coverage_status.replace('_', ' ')}
                      </Pill>
                    </TD>
                    <TD>
                      <Pill tone={sourceTone(c.source)} dot>{c.source_label}</Pill>
                    </TD>
                    <TD className="text-xs text-slate-500" title={c.created_at}>
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
