'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { adminFetch } from '@/components/admin/useAdminAuth';
import {
  PageHeader, PageWrap, TableCard, THead, TH, TD,
  Pill, Pagination, EmptyState, Input, SkeletonRows,
} from '@/components/admin/ui';
import { formatPT, formatPTDate } from '@/lib/time-pt';
import { LuSearch, LuMail } from 'react-icons/lu';

type Contact = {
  id: number; full_name: string; email: string; phone: string | null;
  subject: string | null; source: string | null; created_at: string; purged_at: string | null;
  first_name: string | null; last_name: string | null; help_topic: string | null;
  preferred_contact_method: string | null; best_time: string | null; therapist_requested: string | null;
};

// Renders a cell value or a muted em-dash when the field was left blank.
function val(v: string | null | undefined) {
  return v && v.trim() ? v : <span className="text-ink-faint">—</span>;
}

function relativeTime(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return formatPT(iso);
  const diff = (Date.now() - t) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
  return formatPTDate(iso);
}

export default function AdminContactsPage() {
  const [data, setData] = useState<{ data: Contact[]; total: number } | null>(null);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState('');

  useEffect(() => {
    setData(null);
    adminFetch(`/admin/contacts?page=${page}&limit=25`).then((r) => r.json()).then(setData);
  }, [page]);

  const filtered = useMemo(() => {
    if (!data) return null;
    if (!query.trim()) return data.data;
    const q = query.toLowerCase();
    return data.data.filter(
      (c) =>
        c.full_name.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q) ||
        (c.phone ?? '').toLowerCase().includes(q) ||
        (c.help_topic ?? c.subject ?? '').toLowerCase().includes(q) ||
        (c.therapist_requested ?? '').toLowerCase().includes(q),
    );
  }, [data, query]);

  return (
      <PageWrap>
        <PageHeader
          title="General enquiries — Website"
          subtitle="Submissions from the public website contact form. Message bodies are hidden in this list (HIPAA §164.502(b) minimum necessary). Click a row to view the full record — that access is logged."
          action={
            <div className="relative">
              <LuSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" strokeWidth={2} />
              <Input
                placeholder="Search name, email, phone, topic…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="!w-64 !pl-9"
              />
            </div>
          }
        />

        {!data ? (
          <SkeletonRows rows={6} cols={9} />
        ) : filtered && filtered.length === 0 ? (
          <EmptyState
            title={query ? 'No matches' : 'No contact submissions yet'}
            description={query ? 'Try a different search.' : 'New submissions from the website will appear here.'}
            icon={<LuMail width={22} height={22} strokeWidth={1.8} />}
          />
        ) : (
          <>
            <TableCard>
              <THead>
                <tr>
                  <TH>Name</TH>
                  <TH className="bt-col-hide-sm">Email</TH>
                  <TH className="bt-col-hide-sm">Phone</TH>
                  <TH className="bt-col-hide-md">Help topic</TH>
                  <TH className="bt-col-hide-lg">Preferred contact</TH>
                  <TH className="bt-col-hide-lg">Best time</TH>
                  <TH className="bt-col-hide-lg">Therapist requested</TH>
                  <TH className="bt-col-hide-lg">Received</TH>
                  <TH>Status</TH>
                </tr>
              </THead>
              <motion.tbody initial="initial" animate="animate" variants={{ animate: { transition: { staggerChildren: 0.015 } } }}>
                {filtered!.map((c) => (
                  <motion.tr
                    key={c.id}
                    variants={{ initial: { opacity: 0, y: 4 }, animate: { opacity: 1, y: 0 } }}
                    className="group"
                  >
                    <TD>
                      <Link href={`/admin/contacts/${c.id}`} className="flex items-center gap-3 group/link">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand to-[#cf9e57] text-[13px] font-bold text-white shadow-[0_3px_10px_rgba(225,184,120,0.45)]">
                          {c.full_name[0]?.toUpperCase() ?? '?'}
                        </div>
                        <span className="flex flex-col leading-tight">
                          <span className="font-bold text-ink group-hover/link:text-brand-700">{c.full_name}</span>
                          <span className="font-mono text-[11px] font-normal tabular-nums text-ink-faint">#{c.id}</span>
                        </span>
                      </Link>
                    </TD>
                    <TD className="bt-col-hide-sm break-all">{c.email}</TD>
                    <TD className="bt-col-hide-sm whitespace-nowrap">{val(c.phone)}</TD>
                    <TD className="bt-col-hide-md min-w-[180px] max-w-[280px] whitespace-normal break-words" title={c.help_topic ?? c.subject ?? ''}>
                      {val(c.help_topic ?? c.subject)}
                    </TD>
                    <TD className="bt-col-hide-lg whitespace-normal break-words">{val(c.preferred_contact_method)}</TD>
                    <TD className="bt-col-hide-lg min-w-[120px] max-w-[200px] whitespace-normal break-words" title={c.best_time ?? ''}>{val(c.best_time)}</TD>
                    <TD className="bt-col-hide-lg min-w-[140px] max-w-[220px] whitespace-normal break-words" title={c.therapist_requested ?? ''}>{val(c.therapist_requested)}</TD>
                    <TD className="bt-col-hide-lg whitespace-nowrap text-[12.5px] text-ink-soft" title={formatPT(c.created_at)}>
                      {relativeTime(c.created_at)}
                    </TD>
                    <TD>
                      {c.purged_at ? (
                        <Pill tone="slate">Anonymized</Pill>
                      ) : (
                        <Pill tone="green" dot>Active</Pill>
                      )}
                    </TD>
                  </motion.tr>
                ))}
              </motion.tbody>
            </TableCard>
            <Pagination page={page} total={data.total} pageSize={25} onChange={setPage} />
          </>
        )}
      </PageWrap>
  );
}
