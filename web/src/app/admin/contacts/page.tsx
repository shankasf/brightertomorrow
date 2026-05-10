'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { adminFetch } from '@/components/admin/useAdminAuth';
import {
  PageHeader, PageWrap, TableCard, THead, TH, TR, TD,
  Pill, Pagination, EmptyState, Input, SkeletonRows,
} from '@/components/admin/ui';

type Contact = {
  id: number; full_name: string; email: string; phone: string | null;
  subject: string | null; source: string | null; created_at: string; purged_at: string | null;
};

function relativeTime(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso.slice(0, 16).replace('T', ' ');
  const diff = (Date.now() - t) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
  return iso.slice(0, 10);
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
        (c.subject ?? '').toLowerCase().includes(q),
    );
  }, [data, query]);

  return (
      <PageWrap>
        <PageHeader
          title="Contact submissions"
          subtitle="Message bodies are hidden in this list (HIPAA §164.502(b) minimum necessary). Click a row to view the full record — that access is logged."
          action={
            <div className="relative">
              <svg className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
              </svg>
              <Input
                placeholder="Search name, email, subject…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="!w-64 !pl-9"
              />
            </div>
          }
        />

        {!data ? (
          <SkeletonRows rows={6} cols={6} />
        ) : filtered && filtered.length === 0 ? (
          <EmptyState
            title={query ? 'No matches' : 'No contact submissions yet'}
            description={query ? 'Try a different search.' : 'New submissions from the website will appear here.'}
            icon={
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" />
              </svg>
            }
          />
        ) : (
          <>
            <TableCard>
              <THead>
                <tr>
                  <TH className="w-12">#</TH>
                  <TH>Name</TH>
                  <TH>Email</TH>
                  <TH>Subject</TH>
                  <TH>Received</TH>
                  <TH>Status</TH>
                </tr>
              </THead>
              <motion.tbody initial="initial" animate="animate" variants={{ animate: { transition: { staggerChildren: 0.015 } } }}>
                {filtered!.map((c) => (
                  <motion.tr
                    key={c.id}
                    variants={{ initial: { opacity: 0, y: 4 }, animate: { opacity: 1, y: 0 } }}
                    className="group border-t border-slate-100 transition-colors hover:bg-slate-50/70"
                  >
                    <TD className="font-mono text-xs tabular-nums text-slate-400">{c.id}</TD>
                    <TD>
                      <Link href={`/admin/contacts/${c.id}`} className="flex items-center gap-2.5 group/link">
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-cyan-500 text-[11px] font-semibold text-white shadow-sm">
                          {c.full_name[0]?.toUpperCase() ?? '?'}
                        </div>
                        <span className="font-medium text-slate-900 group-hover/link:text-indigo-600">{c.full_name}</span>
                      </Link>
                    </TD>
                    <TD className="text-slate-600">{c.email}</TD>
                    <TD className="text-slate-600">{c.subject ?? <span className="text-slate-300">—</span>}</TD>
                    <TD className="text-xs text-slate-500">
                      <span title={c.created_at}>{relativeTime(c.created_at)}</span>
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
