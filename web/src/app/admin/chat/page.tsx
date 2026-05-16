'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { adminFetch } from '@/components/admin/useAdminAuth';
import {
  PageHeader, PageWrap, TableCard, THead, TH, TD,
  Pill, Pagination, EmptyState, SkeletonRows,
} from '@/components/admin/ui';
import { formatPT } from '@/lib/time-pt';
import { LuMessageCircle } from 'react-icons/lu';

// Canonical source enum across every admin table — bt.chat_sessions,
// bt.intake_pointers, bt.callback_requests, bt.insurance_checks all speak
// this vocabulary after migration 014. Legacy values 'chat' and 'voice'
// were renamed to 'chat-agent' and 'voice-agent' respectively; the page
// also normalises them at render time in case any cached rows arrive.
type SourceValue = 'chat-agent' | 'voice-agent' | 'voice-phone';

type RawSource = SourceValue | 'chat' | 'voice';

function canonicalSource(s: RawSource): SourceValue {
  if (s === 'chat') return 'chat-agent';
  if (s === 'voice') return 'voice-agent';
  return s;
}

type Session = {
  id: string;
  visitor_id: string | null;
  source: RawSource;
  external_ref: string | null; // Twilio CallSid when source === 'voice-phone'
  started_at: string;
  ended_at: string | null;
  message_count: number;
  purged_at: string | null;
};

function sourceLabel(s: RawSource): string {
  const c = canonicalSource(s);
  if (c === 'voice-phone') return 'Twilio Phone Call';
  if (c === 'voice-agent') return 'Voice (web)';
  return 'Chatbot';
}

function sourceTone(s: RawSource): 'amber' | 'violet' | 'cyan' {
  const c = canonicalSource(s);
  if (c === 'voice-phone') return 'cyan';
  if (c === 'voice-agent') return 'violet';
  return 'amber';
}

function fmtDateTime(iso: string | null): string {
  return formatPT(iso);
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
  const [source, setSource] = useState<'all' | SourceValue>('all');

  useEffect(() => { setPage(1); }, [source]);

  useEffect(() => {
    setData(null);
    const q = new URLSearchParams({ page: String(page), limit: '25' });
    if (source !== 'all') q.set('source', source);
    adminFetch(`/admin/chat/sessions?${q.toString()}`).then((r) => r.json()).then(setData);
  }, [page, source]);

  return (
      <PageWrap>
        <PageHeader
          title="Chat sessions"
          subtitle="Every conversation handled by the AI triage agent — website chatbot, browser voice widget, and Twilio phone calls. Click a session to view the full transcript; that access is logged."
        />

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-soft">Source:</span>
          {(['all', 'chat-agent', 'voice-agent', 'voice-phone'] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setSource(v)}
              className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset transition ${
                source === v
                  ? 'bg-ink text-cream ring-ink'
                  : 'bg-white text-ink-soft ring-slate-200 hover:bg-slate-50'
              }`}
            >
              {v === 'all' ? 'All' : v === 'chat-agent' ? 'Chatbot' : v === 'voice-agent' ? 'Voice (web)' : 'Twilio Phone Call'}
            </button>
          ))}
        </div>

        {!data ? (
          <SkeletonRows rows={6} cols={6} />
        ) : data.data.length === 0 ? (
          <EmptyState
            title="No chat sessions yet"
            description="Sessions started from the website chat widget will appear here."
            icon={<LuMessageCircle width={22} height={22} strokeWidth={1.8} />}
          />
        ) : (
          <>
            <TableCard>
              <THead>
                <tr>
                  <TH>Session</TH>
                  <TH className="bt-col-hide-sm">Source</TH>
                  <TH className="bt-col-hide-md">Started</TH>
                  <TH className="bt-col-hide-xl">Ended</TH>
                  <TH className="bt-col-hide-lg">Duration</TH>
                  <TH className="bt-col-hide-sm">Msgs</TH>
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
                      className="group cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand/50"
                    >
                      <TD>
                        <span className="inline-flex items-center gap-2 font-mono text-[13px] font-bold text-ink group-hover:text-brand-700">
                          <span className="rounded-md bg-cream px-2 py-0.5 ring-1 ring-inset ring-[#EDE6D9] group-hover:bg-brand-50 group-hover:ring-brand-200">
                            {s.id.slice(0, 8)}
                          </span>
                          <span className="text-ink-faint">…</span>
                        </span>
                      </TD>
                      <TD className="bt-col-hide-sm">
                        <Pill tone={sourceTone(s.source)} dot>
                          {sourceLabel(s.source)}
                        </Pill>
                        {s.source === 'voice-phone' && s.external_ref ? (
                          <div className="mt-1 font-mono text-[10px] text-ink-faint" title={`Twilio CallSid: ${s.external_ref}`}>
                            {s.external_ref.slice(0, 10)}…
                          </div>
                        ) : null}
                      </TD>
                      <TD className="bt-col-hide-md whitespace-nowrap text-[12.5px] text-ink-soft">{fmtDateTime(s.started_at)}</TD>
                      <TD className="bt-col-hide-xl whitespace-nowrap text-[12.5px] text-ink-soft">{fmtDateTime(s.ended_at)}</TD>
                      <TD className="bt-col-hide-lg tabular-nums">{dur ?? <span className="text-ink-faint">—</span>}</TD>
                      <TD className="bt-col-hide-sm tabular-nums font-bold text-ink">{s.message_count}</TD>
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
