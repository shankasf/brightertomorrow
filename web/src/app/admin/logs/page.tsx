'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getStoredToken } from '@/components/admin/useAdminAuth';
import { PageHeader, PageWrap, Button, ErrorBanner, Input } from '@/components/admin/ui';

type LogRecord = {
  id: number;
  ts: number;       // epoch seconds
  level: string;    // INFO | WARNING | ERROR | DEBUG
  logger: string;
  msg: string;
};

type Status = 'idle' | 'connecting' | 'open' | 'closed' | 'error';

const MAX_KEEP = 2000;

// Streaming log timestamp — render in Pacific Time so PT-based staff see a
// consistent wall-clock regardless of their browser timezone. Milliseconds
// stay browser-local because the source epoch is the same instant.
const LOG_TS_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Los_Angeles',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

function fmtTs(epochSec: number): string {
  const d = new Date(epochSec * 1000);
  const parts = LOG_TS_FMT.formatToParts(d);
  const hh = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const mm = parts.find((p) => p.type === 'minute')?.value ?? '00';
  const ss = parts.find((p) => p.type === 'second')?.value ?? '00';
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${hh}:${mm}:${ss}.${ms} PT`;
}

function levelStyle(level: string): string {
  switch (level) {
    case 'ERROR':
    case 'CRITICAL':
      return 'text-rose-700 bg-rose-50 ring-rose-200';
    case 'WARNING':
      return 'text-amber-700 bg-amber-50 ring-amber-200';
    case 'INFO':
      return 'text-emerald-700 bg-emerald-50 ring-emerald-200';
    case 'DEBUG':
      return 'text-slate-600 bg-slate-50 ring-slate-200';
    default:
      return 'text-slate-700 bg-slate-50 ring-slate-200';
  }
}

export default function AdminLogsPage() {
  const [records, setRecords] = useState<LogRecord[]>([]);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState('');
  const [paused, setPaused] = useState(false);
  const [autoscroll, setAutoscroll] = useState(true);
  const [levelFilter, setLevelFilter] = useState<'ALL' | 'INFO' | 'WARNING' | 'ERROR'>('ALL');
  const [search, setSearch] = useState('');

  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const append = useCallback((rec: LogRecord) => {
    if (pausedRef.current) return;
    setRecords((prev) => {
      const next = prev.length >= MAX_KEEP ? prev.slice(prev.length - MAX_KEEP + 1) : prev.slice();
      next.push(rec);
      return next;
    });
  }, []);

  const connect = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setStatus('connecting');
    setError('');
    try {
      const token = getStoredToken();
      if (!token) {
        setStatus('error');
        setError('Not signed in.');
        return;
      }
      const resp = await fetch('/admin/api/logs/ai', {
        headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
        signal: controller.signal,
        cache: 'no-store',
      });
      if (!resp.ok) {
        setStatus('error');
        setError(`Upstream returned ${resp.status}.`);
        return;
      }
      if (!resp.body) {
        setStatus('error');
        setError('Streaming not supported by this response.');
        return;
      }
      setStatus('open');

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          setStatus('closed');
          break;
        }
        buf += decoder.decode(value, { stream: true });
        // SSE messages are separated by \n\n; lines starting with `data: ` carry JSON.
        let idx: number;
        // eslint-disable-next-line no-cond-assign
        while ((idx = buf.indexOf('\n\n')) !== -1) {
          const block = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          for (const line of block.split('\n')) {
            if (!line.startsWith('data: ')) continue;
            try {
              const rec = JSON.parse(line.slice(6)) as LogRecord;
              append(rec);
            } catch {
              // ignore malformed frames
            }
          }
        }
      }
    } catch (e: unknown) {
      if ((e as DOMException)?.name === 'AbortError') {
        setStatus('closed');
        return;
      }
      setStatus('error');
      setError((e as Error)?.message ?? 'Stream error.');
    }
  }, [append]);

  // Open the stream on mount; close on unmount.
  useEffect(() => {
    void connect();
    return () => {
      abortRef.current?.abort();
    };
  }, [connect]);

  // Autoscroll to bottom when new records arrive (if enabled).
  useEffect(() => {
    if (!autoscroll) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [records, autoscroll]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return records.filter((r) => {
      if (levelFilter !== 'ALL' && r.level !== levelFilter) return false;
      if (!q) return true;
      return (
        r.msg.toLowerCase().includes(q) ||
        r.logger.toLowerCase().includes(q)
      );
    });
  }, [records, levelFilter, search]);

  const counts = useMemo(() => {
    const c = { ERROR: 0, WARNING: 0, INFO: 0, DEBUG: 0 };
    for (const r of records) {
      if (r.level === 'ERROR' || r.level === 'CRITICAL') c.ERROR++;
      else if (r.level === 'WARNING') c.WARNING++;
      else if (r.level === 'INFO') c.INFO++;
      else if (r.level === 'DEBUG') c.DEBUG++;
    }
    return c;
  }, [records]);

  return (
    <PageWrap max="max-w-7xl">
      <PageHeader
        title="Live AI logs"
        subtitle={
          <>
            Live stream from the <span className="font-medium text-ink">bt-ai</span> service
            (INFO level and above). Records may contain operational PHI (patient identifiers,
            tool latencies). Each viewing session is recorded in the{' '}
            <span className="font-medium text-ink">admin access log</span>. §164.312(b)
          </>
        }
        action={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={status} />
            <Button onClick={() => setPaused((p) => !p)}>
              {paused ? 'Resume' : 'Pause'}
            </Button>
            <Button onClick={() => setRecords([])}>Clear</Button>
            <Button onClick={connect}>Reconnect</Button>
          </div>
        }
      />

      {error && <ErrorBanner>{error}</ErrorBanner>}

      <div className="mb-3 grid grid-cols-1 gap-3 rounded-xl border border-[#E5E5E5] bg-white p-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="flex flex-col text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-soft">
          Level
          <select
            value={levelFilter}
            onChange={(e) => setLevelFilter(e.target.value as 'ALL' | 'INFO' | 'WARNING' | 'ERROR')}
            className="mt-1 h-9 rounded-md border border-slate-200 bg-white px-2 text-sm text-ink focus:border-brand focus:outline-none"
          >
            <option value="ALL">All ({records.length})</option>
            <option value="ERROR">Error ({counts.ERROR})</option>
            <option value="WARNING">Warning ({counts.WARNING})</option>
            <option value="INFO">Info ({counts.INFO})</option>
          </select>
        </label>
        <label className="flex flex-col text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-soft sm:col-span-2">
          Search (logger name or message)
          <Input
            placeholder="e.g. tool_ok, intake, request_intake_callback"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="!mt-1"
          />
        </label>
        <label className="flex flex-col text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-soft">
          Autoscroll
          <button
            type="button"
            onClick={() => setAutoscroll((v) => !v)}
            className={`mt-1 inline-flex h-9 items-center justify-center rounded-md border px-3 text-sm font-medium ${
              autoscroll
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                : 'border-slate-200 bg-white text-slate-600'
            }`}
          >
            {autoscroll ? 'On' : 'Off'}
          </button>
        </label>
      </div>

      <div
        ref={scrollRef}
        className="h-[60vh] overflow-y-auto rounded-xl border border-[#E5E5E5] bg-[#0F1620] p-3 font-mono text-[12px] leading-relaxed text-cream/90 shadow-inner"
      >
        {filtered.length === 0 ? (
          <div className="grid h-full place-items-center text-cream/40">
            {status === 'connecting' && 'Connecting…'}
            {status === 'open' && records.length === 0 && 'Waiting for the first log line…'}
            {status === 'open' && records.length > 0 && 'No records match the current filter.'}
            {status === 'closed' && 'Stream closed.'}
            {status === 'error' && (error || 'Stream error.')}
            {status === 'idle' && 'Idle.'}
          </div>
        ) : (
          filtered.map((r) => (
            <div key={r.id} className="flex gap-2 py-0.5">
              <span className="shrink-0 tabular-nums text-cream/40">{fmtTs(r.ts)}</span>
              <span
                className={`shrink-0 self-start rounded px-1.5 py-[1px] text-[10px] font-semibold uppercase ring-1 ring-inset ${levelStyle(
                  r.level,
                )}`}
              >
                {r.level}
              </span>
              <span className="shrink-0 text-cream/60">{r.logger}</span>
              <span className="break-words text-cream/90">{r.msg}</span>
            </div>
          ))
        )}
      </div>

      <div className="mt-2 flex items-center justify-between text-[11px] text-ink-soft">
        <span>
          Showing {filtered.length} of {records.length} records (buffer cap {MAX_KEEP}).
        </span>
        {paused && <span className="font-semibold text-amber-700">Paused — new records dropped</span>}
      </div>
    </PageWrap>
  );
}

function StatusBadge({ status }: { status: Status }) {
  const map: Record<Status, { label: string; cls: string }> = {
    idle: { label: 'idle', cls: 'bg-slate-100 text-slate-700 ring-slate-200' },
    connecting: { label: 'connecting…', cls: 'bg-amber-50 text-amber-700 ring-amber-200' },
    open: { label: 'live', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
    closed: { label: 'closed', cls: 'bg-slate-100 text-slate-700 ring-slate-200' },
    error: { label: 'error', cls: 'bg-rose-50 text-rose-700 ring-rose-200' },
  };
  const m = map[status];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${m.cls}`}>
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          status === 'open' ? 'animate-pulse bg-emerald-500' : 'bg-slate-400'
        }`}
      />
      {m.label}
    </span>
  );
}
