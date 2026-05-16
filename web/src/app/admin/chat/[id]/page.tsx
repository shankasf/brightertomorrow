'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { adminFetch } from '@/components/admin/useAdminAuth';
import { Card, ErrorBanner, PageWrap, PHIBadge, Pill } from '@/components/admin/ui';
import { formatPT, formatPTDate, formatPTTime } from '@/lib/time-pt';
import { LuChevronLeft } from 'react-icons/lu';

type Message = { id: number; role: string; content: string; tool_name: string | null; created_at: string };
// Canonical agent enum (migration 014). Older rows may still arrive with
// legacy short aliases — canonicalSource() normalises them at render time.
type SourceValue = 'chat-agent' | 'voice-agent' | 'voice-phone';
type RawSource = SourceValue | 'chat' | 'voice';

function canonicalSource(s: RawSource): SourceValue {
  if (s === 'chat') return 'chat-agent';
  if (s === 'voice') return 'voice-agent';
  return s;
}

type SessionDetail = {
  session: {
    id: string; visitor_id: string | null;
    source: RawSource;
    external_ref: string | null;   // Twilio CallSid when source === 'voice-phone'
    started_at: string;
    ended_at: string | null; retain_until: string | null; purged_at: string | null;
  };
  messages: Message[];
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

const roleStyle: Record<string, { bg: string; text: string; label: string; align: 'left' | 'right' }> = {
  user: { bg: 'bg-gradient-to-br from-indigo-500 to-indigo-600 text-white', text: 'text-white', label: 'Visitor', align: 'right' },
  assistant: { bg: 'bg-white ring-1 ring-inset ring-slate-200', text: 'text-slate-800', label: 'Assistant', align: 'left' },
  system: { bg: 'bg-violet-50 ring-1 ring-inset ring-violet-200', text: 'text-violet-900', label: 'System', align: 'left' },
  tool: { bg: 'bg-amber-50 ring-1 ring-inset ring-amber-200', text: 'text-amber-900', label: 'Tool', align: 'left' },
};

export default function ChatSessionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    adminFetch(`/admin/chat/sessions/${id}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(setDetail)
      .catch(() => setError('Not found or access denied'));
  }, [id]);

  return (
      <PageWrap max="max-w-4xl">
        <Link href="/admin/chat" className="mb-4 inline-flex items-center gap-1.5 text-sm text-slate-500 transition-colors hover:text-indigo-600">
          <LuChevronLeft width={14} height={14} strokeWidth={2} />
          Back to chat sessions
        </Link>

        {error && <ErrorBanner>{error}</ErrorBanner>}

        {detail && (
          <>
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
              className="mb-6 flex items-start justify-between gap-4"
            >
              <div>
                <h1 className="font-mono text-base font-semibold text-slate-900">{id}</h1>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <Pill tone={sourceTone(detail.session.source)} dot>
                    {sourceLabel(detail.session.source)}
                  </Pill>
                  {detail.session.purged_at ? (
                    <Pill tone="slate">Anonymized</Pill>
                  ) : detail.session.ended_at ? (
                    <Pill tone="blue">Ended</Pill>
                  ) : (
                    <Pill tone="green" dot>Active</Pill>
                  )}
                  {detail.session.source === 'voice-phone' && detail.session.external_ref ? (
                    <span className="font-mono text-[11px] text-slate-400" title="Twilio CallSid — cross-reference in Twilio Console">
                      CallSid: {detail.session.external_ref}
                    </span>
                  ) : null}
                </div>
              </div>
              <PHIBadge />
            </motion.div>

            <Card className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
              {(
                [
                  ['Started', formatPT(detail.session.started_at)],
                  ['Ended', formatPT(detail.session.ended_at)],
                  ['Retain until', formatPTDate(detail.session.retain_until)],
                  ['Anonymized', detail.session.purged_at ? formatPTDate(detail.session.purged_at) : 'No'],
                ] as [string, string][]
              ).map(([label, value]) => (
                <div key={label}>
                  <div className="text-[11px] font-medium uppercase tracking-wider text-slate-500">{label}</div>
                  <div className="mt-1 text-sm font-medium text-slate-800">{value}</div>
                </div>
              ))}
            </Card>

            <div className="space-y-3">
              {detail.messages.map((m, i) => {
                const s = roleStyle[m.role] ?? roleStyle.assistant;
                return (
                  <motion.div
                    key={m.id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(i * 0.02, 0.5), duration: 0.25 }}
                    className={`flex ${s.align === 'right' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div className={`max-w-[85%] rounded-2xl px-4 py-3 shadow-sm ${s.bg}`}>
                      <div className={`mb-1 flex items-center justify-between gap-3 text-[10px] font-semibold uppercase tracking-wider opacity-70 ${s.text}`}>
                        <span>{s.label}{m.tool_name ? ` · ${m.tool_name}` : ''}</span>
                        <span className="font-mono opacity-70">{formatPTTime(m.created_at)}</span>
                      </div>
                      <p className={`whitespace-pre-wrap text-sm leading-relaxed ${s.text}`}>{m.content}</p>
                    </div>
                  </motion.div>
                );
              })}
              {detail.messages.length === 0 && (
                <p className="rounded-xl border border-dashed border-slate-200 bg-white py-8 text-center text-sm text-slate-400">
                  No messages in this session.
                </p>
              )}
            </div>
          </>
        )}
      </PageWrap>
  );
}
