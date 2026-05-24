'use client';
import { useCallback, useMemo, useState } from 'react';
import { getStoredToken } from '@/components/admin/useAdminAuth';
import { Button, ErrorBanner, Input } from '@/components/admin/ui';

type SearchRow = {
  log_id: string;
  ts: string;
  ingestion_ts: string;
  level: string;
  service: string;
  message: string;
  logger: string | null;
  session_id: string | null;
  patient_id: string | null;
  trace_id: string | null;
  request_id: string | null;
  pod: string | null;
  container: string | null;
  host: string | null;
};

type SearchResponse = {
  queryId: string;
  count: number;
  rows: SearchRow[];
};

const SERVICES = ['frontend', 'gateway', 'bt-ai', 'web'] as const;
const LEVELS = ['DEBUG', 'INFO', 'WARN', 'ERROR'] as const;

const RANGE_PRESETS = [
  { label: 'Last 1h', minutes: 60 },
  { label: 'Last 6h', minutes: 360 },
  { label: 'Last 24h', minutes: 1440 },
  { label: 'Last 7d', minutes: 7 * 1440 },
];

function fmtTs(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString('en-US', {
      timeZone: 'America/Los_Angeles',
      year: '2-digit',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  } catch {
    return iso;
  }
}

function levelStyle(level: string): string {
  switch (level.toUpperCase()) {
    case 'ERROR':
    case 'CRITICAL':
      return 'text-rose-700 bg-rose-50 ring-rose-200';
    case 'WARN':
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

function serviceStyle(svc: string): string {
  switch (svc) {
    case 'bt-ai':
      return 'bg-violet-50 text-violet-700 ring-violet-200';
    case 'gateway':
      return 'bg-sky-50 text-sky-700 ring-sky-200';
    case 'frontend':
      return 'bg-amber-50 text-amber-700 ring-amber-200';
    case 'web':
      return 'bg-teal-50 text-teal-700 ring-teal-200';
    default:
      return 'bg-slate-50 text-slate-700 ring-slate-200';
  }
}

export function LogSearchPanel() {
  const [services, setServices] = useState<string[]>([]);
  const [levels, setLevels] = useState<string[]>([]);
  const [rangeMin, setRangeMin] = useState<number>(60);
  const [text, setText] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [patientId, setPatientId] = useState('');
  const [limit, setLimit] = useState(200);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [rows, setRows] = useState<SearchRow[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [lastQueryId, setLastQueryId] = useState('');

  const toggle = useCallback((value: string, set: string[], setter: (v: string[]) => void) => {
    setter(set.includes(value) ? set.filter((v) => v !== value) : [...set, value]);
  }, []);

  const runSearch = useCallback(async () => {
    setLoading(true);
    setError('');
    setRows([]);
    setExpanded(null);
    try {
      const token = getStoredToken();
      if (!token) {
        setError('Not signed in.');
        return;
      }
      const now = new Date();
      const from = new Date(now.getTime() - rangeMin * 60_000);
      const params = new URLSearchParams();
      params.set('from', from.toISOString());
      params.set('to', now.toISOString());
      if (services.length) params.set('service', services.join(','));
      if (levels.length) params.set('level', levels.join(','));
      if (text.trim()) params.set('text', text.trim());
      if (sessionId.trim()) params.set('session_id', sessionId.trim());
      if (patientId.trim()) params.set('patient_id', patientId.trim());
      params.set('limit', String(limit));

      const resp = await fetch(`/admin/api/logs/search?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      if (!resp.ok) {
        const body = await resp.text();
        setError(`Search failed (${resp.status}): ${body.slice(0, 200)}`);
        return;
      }
      const json = (await resp.json()) as SearchResponse;
      setRows(json.rows ?? []);
      setLastQueryId(json.queryId ?? '');
    } catch (e) {
      setError((e as Error)?.message ?? 'Search error.');
    } finally {
      setLoading(false);
    }
  }, [services, levels, rangeMin, text, sessionId, patientId, limit]);

  const headerSummary = useMemo(() => {
    if (loading) return 'Searching…';
    if (rows.length === 0) return 'No results yet — set filters and Search.';
    return `${rows.length} result${rows.length === 1 ? '' : 's'} (newest first)`;
  }, [loading, rows.length]);

  return (
    <div className="space-y-3">
      {/* Filters */}
      <div className="grid grid-cols-1 gap-3 rounded-xl border border-[#E5E5E5] bg-white p-4 lg:grid-cols-12">
        <div className="lg:col-span-3">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-soft">
            Services
          </div>
          <div className="flex flex-wrap gap-1.5">
            {SERVICES.map((s) => {
              const on = services.includes(s);
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => toggle(s, services, setServices)}
                  className={`rounded-md border px-2 py-1 text-xs font-medium ${
                    on
                      ? 'border-brand bg-brand/10 text-brand'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {s}
                </button>
              );
            })}
          </div>
        </div>

        <div className="lg:col-span-3">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-soft">
            Levels
          </div>
          <div className="flex flex-wrap gap-1.5">
            {LEVELS.map((l) => {
              const on = levels.includes(l);
              return (
                <button
                  key={l}
                  type="button"
                  onClick={() => toggle(l, levels, setLevels)}
                  className={`rounded-md border px-2 py-1 text-xs font-medium ${
                    on
                      ? 'border-brand bg-brand/10 text-brand'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {l}
                </button>
              );
            })}
          </div>
        </div>

        <div className="lg:col-span-3">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-soft">
            Range
          </div>
          <div className="flex flex-wrap gap-1.5">
            {RANGE_PRESETS.map((p) => (
              <button
                key={p.minutes}
                type="button"
                onClick={() => setRangeMin(p.minutes)}
                className={`rounded-md border px-2 py-1 text-xs font-medium ${
                  rangeMin === p.minutes
                    ? 'border-brand bg-brand/10 text-brand'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div className="lg:col-span-3">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-soft">
            Limit
          </div>
          <select
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
            className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm text-ink focus:border-brand focus:outline-none"
          >
            <option value={50}>50 rows</option>
            <option value={100}>100 rows</option>
            <option value={200}>200 rows</option>
            <option value={500}>500 rows</option>
          </select>
        </div>

        <div className="lg:col-span-6">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-soft">
            Free-text (message or logger contains)
          </div>
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="e.g. timeout, request_intake_callback, insurance"
          />
        </div>

        <div className="lg:col-span-3">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-soft">
            Session ID
          </div>
          <Input
            value={sessionId}
            onChange={(e) => setSessionId(e.target.value)}
            placeholder="exact match"
          />
        </div>

        <div className="lg:col-span-3">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-soft">
            Patient ID
          </div>
          <Input
            value={patientId}
            onChange={(e) => setPatientId(e.target.value)}
            placeholder="exact match"
          />
        </div>

        <div className="lg:col-span-12 flex items-center justify-between gap-2">
          <div className="text-[11px] text-ink-soft">{headerSummary}</div>
          <Button onClick={runSearch}>{loading ? 'Searching…' : 'Search'}</Button>
        </div>
      </div>

      {error && <ErrorBanner>{error}</ErrorBanner>}

      {/* Results */}
      <div className="overflow-hidden rounded-xl border border-[#E5E5E5] bg-white">
        {rows.length === 0 && !loading ? (
          <div className="grid place-items-center p-10 text-sm text-ink-soft">
            Set filters above and click Search.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-soft">
                <tr>
                  <th className="px-3 py-2 text-left">When (PT)</th>
                  <th className="px-3 py-2 text-left">Svc</th>
                  <th className="px-3 py-2 text-left">Lvl</th>
                  <th className="px-3 py-2 text-left">Message</th>
                  <th className="px-3 py-2 text-left">Logger</th>
                  <th className="px-3 py-2 text-left">Session</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const open = expanded === r.log_id;
                  return (
                    <>
                      <tr
                        key={r.log_id}
                        className="cursor-pointer border-t border-slate-100 hover:bg-slate-50"
                        onClick={() => setExpanded(open ? null : r.log_id)}
                      >
                        <td className="whitespace-nowrap px-3 py-2 text-xs tabular-nums text-ink-soft">
                          {fmtTs(r.ts)}
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={`inline-flex rounded px-1.5 py-[1px] text-[10px] font-semibold ring-1 ring-inset ${serviceStyle(
                              r.service,
                            )}`}
                          >
                            {r.service}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={`inline-flex rounded px-1.5 py-[1px] text-[10px] font-semibold uppercase ring-1 ring-inset ${levelStyle(
                              r.level,
                            )}`}
                          >
                            {r.level}
                          </span>
                        </td>
                        <td className="max-w-xl truncate px-3 py-2 text-ink">{r.message}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-xs text-ink-soft">
                          {r.logger ?? '—'}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-xs text-ink-soft">
                          {r.session_id ? r.session_id.slice(0, 8) + '…' : '—'}
                        </td>
                      </tr>
                      {open && (
                        <tr key={r.log_id + '-detail'} className="bg-slate-50/50">
                          <td colSpan={6} className="px-3 py-3">
                            <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-md bg-[#0F1620] p-3 font-mono text-[12px] text-cream/90">
                              {JSON.stringify(r, null, 2)}
                            </pre>
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {lastQueryId && (
        <div className="text-[10px] text-ink-soft">
          Athena query id: <span className="font-mono">{lastQueryId}</span>
        </div>
      )}
    </div>
  );
}
