'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { adminFetch } from '@/components/admin/useAdminAuth';
import {
  PageHeader, PageWrap, TableCard, THead, TH, TD,
  Pill, Pagination, EmptyState, SkeletonRows,
} from '@/components/admin/ui';

type Session = {
  id: string; visitor_id: string | null; source: 'chat' | 'voice'; started_at: string;
  ended_at: string | null; message_count: number; purged_at: string | null;
};

function fmtDateTime(iso: string | null): string {
  if (!iso) return '—';
  return iso.slice(0, 16).replace('T', ' ');
}

function durationBetween(a: string, b: string | null): string | null {
  if (!b) return null;
  const ms = Date.parse(b) - Date.parse(a);
  if (!Number.isFinite(ms) || ms < 0) return null;
  const m = Math.round(ms / 60000);
  if (m < 1) return '<1m';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export default function AdminChatPage() {
  const router = useRouter();
  const [data, setData] = useState<{ data: Session[]; total: number } | null>(null);
  const [page, setPage] = useState(1);

  useEffect(() => {
    setData(null);
    adminFetch(`/admin/chat/sessions?page=${page}&limit=25`).then((r) => r.json()).then(setData);
  }, [page]);

  return (
      <PageWrap>
        <PageHeader
          title="Chat sessions"
          subtitle="Visitor conversations handled by the AI triage agent. Click a session to view the full transcript — that access is logged."
        />

        {!data ? (
          <SkeletonRows rows={6} cols={6} />
        ) : data.data.length === 0 ? (
          <EmptyState
            title="No chat sessions yet"
            description="Sessions started from the website chat widget will appear here."
            icon={
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M21 12a8 8 0 0 1-11.4 7.2L3 21l1.8-6.6A8 8 0 1 1 21 12z" />
              </svg>
            }
          />
        ) : (
          <>
            <TableCard>
              <THead>
                <tr>
                  <TH>Session</TH>
                  <TH>Source</TH>
                  <TH>Started</TH>
                  <TH>Ended</TH>
                  <TH>Duration</TH>
                  <TH className="text-center">Messages</TH>
                  <TH>Status</TH>
                </tr>
              </THead>
              <motion.tbody initial="initial" animate="animate" variants={{ animate: { transition: { staggerChildren: 0.015 } } }}>
                {data.data.map((s) => {
                  const dur = durationBetween(s.started_at, s.ended_at);
                  const href = `/admin/chat/${s.id}`;
                  return (
                    <motion.tr
                      key={s.id}
                      variants={{ initial: { opacity: 0, y: 4 }, animate: { opacity: 1, y: 0 } }}
                      onClick={() => router.push(href)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          router.push(href);
                        }
                      }}
                      onMouseDown={(e) => {
                        if (e.button === 1) {
                          e.preventDefault();
                          window.open(href, '_blank', 'noopener,noreferrer');
                        }
                      }}
                      role="link"
                      tabIndex={0}
                      className="group cursor-pointer border-t border-slate-100 transition-colors hover:bg-slate-50/70 focus:bg-slate-50/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-300"
                    >
                      <TD>
                        <span className="inline-flex items-center gap-2 font-mono text-xs text-indigo-600 group-hover:text-indigo-700">
                          <span className="rounded-md bg-slate-100 px-1.5 py-0.5 ring-1 ring-inset ring-slate-200 group-hover:bg-indigo-50 group-hover:ring-indigo-200">
                            {s.id.slice(0, 8)}
                          </span>
                          <span className="text-slate-400">…</span>
                        </span>
                      </TD>
                      <TD>
                        <Pill tone={s.source === 'voice' ? 'violet' : 'amber'} dot>
                          {s.source === 'voice' ? 'Voice' : 'Chat'}
                        </Pill>
                      </TD>
                      <TD className="text-xs text-slate-500">{fmtDateTime(s.started_at)}</TD>
                      <TD className="text-xs text-slate-500">{fmtDateTime(s.ended_at)}</TD>
                      <TD className="text-xs tabular-nums text-slate-600">{dur ?? <span className="text-slate-300">—</span>}</TD>
                      <TD className="text-center font-medium tabular-nums text-slate-700">{s.message_count}</TD>
                      <TD>
                        {s.purged_at ? (
                          <Pill tone="slate">Anonymized</Pill>
                        ) : s.ended_at ? (
                          <Pill tone="blue">Ended</Pill>
                        ) : (
                          <Pill tone="green" dot>Active</Pill>
                        )}
                      </TD>
                    </motion.tr>
                  );
                })}
              </motion.tbody>
            </TableCard>
            <Pagination page={page} total={data.total} pageSize={25} onChange={setPage} />
          </>
        )}
      </PageWrap>
  );
}
