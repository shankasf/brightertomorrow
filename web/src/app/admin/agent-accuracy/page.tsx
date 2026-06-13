'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { adminFetch } from '@/components/admin/useAdminAuth';
import {
  PageHeader,
  PageWrap,
  ErrorBanner,
  Button,
  Pill,
  EmptyState,
  LoadingScreen,
  staggerContainer,
  staggerItem,
} from '@/components/admin/ui';
import {
  MultiAreaChart,
  Sparkline,
  Gauge,
  HBarChart,
  ConfusionMatrix,
  PercentileBars,
} from '@/components/admin/charts';
import {
  LuTarget,
  LuPlay,
  LuChevronDown,
  LuCircleCheck,
  LuCircleX,
  LuActivity,
} from 'react-icons/lu';

// ─────────────────────────────────────────────────────────────────────────────
// API types — mirror gateway agent-accuracy handlers exactly.
// ─────────────────────────────────────────────────────────────────────────────
type RunKind = 'offline' | 'online';

type RegressionStatus = 'pass' | 'warn' | 'fail' | 'baseline';

type RegressionViolation = {
  metric: string;
  baseline: number;
  current: number;
  delta: number;
  threshold: number;
};

type Regression = {
  status: RegressionStatus;
  baseline_run_id: string;
  baseline_created_at: string;
  deltas: Record<string, number>;
  violations: RegressionViolation[];
};

type RunSummary = {
  run_id: string;
  kind: RunKind;
  // Which agent surface this run evaluated. Older runs may omit it → treat as chat.
  channel?: Channel;
  model: string;
  prompt_version: string;
  created_at: string; // RFC3339
  counts: { conversations: number; turns: number };
  // ADDITIVE (optional — historical runs won't have it). Content hash of the golden set used.
  dataset_version?: string;
  // ADDITIVE (optional). Comparison of this run's metrics vs the previous offline run.
  regression?: Regression | null;
  // ADDITIVE (optional — historical runs won't have it). Maps a metric key to the number
  // of evaluated items behind that value. Keys mirror `metrics` (+ session-level rates,
  // `judge_agreement`, and `latency` for the p50/p95/p99 tiles).
  metric_counts?: Record<string, number>;
  metrics: {
    intent_accuracy: number;
    task_completion_rate: number;
    containment_rate: number;
    deflection_rate: number;
    escalation_rate: number;
    hallucination_rate: number;
    tool_precision: number;
    tool_recall: number;
    tool_f1: number;
    faithfulness_avg: number; // 1–5
    relevancy_avg: number; // 1–5
    tone_avg: number; // 1–5
    topic_adherence_rate: number;
    deterministic_pass_rate: number;
    overall_pass_rate: number;
    // ADDITIVE (optional). 0–1 — how often the AI judge matches the human-labeled gold set.
    judge_agreement?: number;
  };
  breakdowns: {
    by_intent: Record<string, { count: number; pass_rate: number; accuracy: number }>;
    by_scene: Record<string, { count: number; pass_rate: number }>;
    // ADDITIVE (optional). Same shape as by_scene; keyed by named test-set split.
    by_split?: Record<string, { count: number; pass_rate: number }>;
    confusion: Record<string, Record<string, number>>;
    latency: { p50: number; p95: number; p99: number };
  };
};

type TurnDetail = {
  seq: number;
  session_id: string;
  convo_name: string;
  is_production: boolean;
  user_says: string;
  reply: string;
  scene: string;
  intent: string;
  expected_intent: string;
  passed: boolean;
  // ADDITIVE (optional — historical runs won't have it). Named test-set split this chat belongs to.
  split?: string;
  deterministic_scores: { name: string; passed: boolean; detail: string }[];
  judge: {
    faithfulness: number;
    relevancy: number;
    tone: number;
    topic_adherence: boolean;
    task_completion: boolean;
    rationale: string;
  };
  latency_ms: number;
};

type SummaryResp = { latest: RunSummary | null; trend: RunSummary[] };
type RunDetailResp = { run: RunSummary; turns: TurnDetail[] };

// Brand palette (mirrors dashboard).
const C = {
  gold: '#E1B878',
  wine: '#66202A',
  teal: '#75ACC0',
  peach: '#FFBC7D',
  navy: '#192735',
  emerald: '#3a7a5d',
  amber: '#B26A18',
  rose: '#9F2A3A',
};

type Tab = 'overview' | 'breakdowns' | 'datasets' | 'failures';

// The three agent surfaces evaluated separately. Internal keys stay short; the
// dashboard shows friendly labels.
type Channel = 'chat' | 'voice' | 'phone';

const CHANNELS: Channel[] = ['chat', 'voice', 'phone'];

const CHANNEL_LABELS: Record<Channel, string> = {
  chat: 'Website Chatbot',
  voice: 'Voice Bot',
  phone: 'Twilio Phone Calls',
};

// Voice/phone offline runs are text-simulations of the realtime agent prompt,
// not live audio — surfaced so the numbers aren't over-read.
const CHANNEL_NOTE: Record<Channel, string> = {
  chat: '',
  voice:
    'Voice Bot offline runs text-simulate the realtime voice agent’s actual prompt (not live audio). Online runs judge real sampled voice sessions.',
  phone:
    'Twilio Phone offline runs text-simulate the phone agent’s actual prompt (not live audio). Online runs judge real sampled phone calls.',
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const score5 = (n: number) => `${n.toFixed(1)} / 5`;

/**
 * Tiny muted "n=NN" sample-size annotation shown beside a metric value.
 * Renders nothing when the count is absent/invalid so old runs (no `metric_counts`)
 * degrade silently. `suffix` distinguishes session-level denominators (e.g. "chats").
 */
function NLabel({
  n,
  suffix,
  className = '',
}: {
  n: number | undefined;
  suffix?: string;
  className?: string;
}) {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return null;
  const unit = (suffix || 'chats').trim();
  return (
    <span className={`text-[10px] tabular-nums text-ink-faint ${className}`}>
      based on {n.toLocaleString()} {unit}
    </span>
  );
}

/** Human-readable labels for the metric keys the regression payload references. */
const METRIC_LABELS: Record<string, string> = {
  overall_pass_rate: 'Overall pass rate',
  intent_accuracy: 'Intent accuracy',
  task_completion_rate: 'Task completion',
  containment_rate: 'Containment',
  deflection_rate: 'Deflection rate',
  escalation_rate: 'Escalation rate',
  hallucination_rate: 'Hallucination rate',
  tool_precision: 'Tool precision',
  tool_recall: 'Tool recall',
  tool_f1: 'Tool F1',
  faithfulness_avg: 'Faithfulness',
  relevancy_avg: 'Relevancy',
  tone_avg: 'Tone',
  topic_adherence_rate: 'Topic adherence',
  deterministic_pass_rate: 'Deterministic pass rate',
  judge_agreement: 'Judge ↔ gold agreement',
};

/** Best-effort human label for a metric key, with a readable fallback. */
function metricLabel(key: string): string {
  if (METRIC_LABELS[key]) return METRIC_LABELS[key];
  return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Format a raw metric value the way it reads on this page (1–5 dims vs 0–1 rates). */
function fmtMetricValue(key: string, v: number): string {
  if (key.endsWith('_avg')) return v.toFixed(2);
  return v.toFixed(2);
}

/** Signed delta string, e.g. "+0.04" / "−0.14". */
function fmtDelta(n: number): string {
  const sign = n > 0 ? '+' : n < 0 ? '−' : '±';
  return `${sign}${Math.abs(n).toFixed(2)}`;
}

/** Threshold color for a 0–1 rate. invert=true → lower is better (hallucination, escalation). */
function rateColor(v: number, invert = false): { hex: string; cls: string } {
  const good = invert ? v <= 0.1 : v >= 0.9;
  const ok = invert ? v <= 0.25 : v >= 0.75;
  if (good) return { hex: C.emerald, cls: 'text-emerald-700' };
  if (ok) return { hex: C.amber, cls: 'text-amber-700' };
  return { hex: C.rose, cls: 'text-rose-700' };
}

function fmtTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d);
}

function fmtShort(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    month: 'short',
    day: 'numeric',
  }).format(d);
}

// ─────────────────────────────────────────────────────────────────────────────
// Card shell (matches dashboard ChartCard)
// ─────────────────────────────────────────────────────────────────────────────
function SectionCard({
  title,
  eyebrow,
  right,
  children,
  className = '',
}: {
  title: string;
  eyebrow?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      variants={staggerItem}
      className={`relative overflow-hidden rounded-2xl border border-[#E5E5E5] bg-white shadow-[0_1px_2px_rgba(25,39,53,0.04)] ${className}`}
    >
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand/40 to-transparent" />
      <div className="flex items-start justify-between gap-3 border-b border-[#EDE6D9]/70 px-5 py-4">
        <div className="min-w-0">
          {eyebrow && (
            <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-brand-700">
              {eyebrow}
            </div>
          )}
          <h3 className="mt-0.5 font-display text-[15px] font-semibold tracking-tight text-ink">
            {title}
          </h3>
        </div>
        {right && <div className="shrink-0">{right}</div>}
      </div>
      <div className="px-5 py-5">{children}</div>
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Metric KPI card — big number + sparkline of that metric across runs.
// ─────────────────────────────────────────────────────────────────────────────
function MetricKPI({
  label,
  sub,
  value,
  series,
  invert = false,
  n,
  nSuffix,
}: {
  label: string;
  sub: string;
  value: number; // 0–1 rate
  series: number[]; // chronological values 0–1
  invert?: boolean;
  n?: number;
  nSuffix?: string;
}) {
  const { hex, cls } = rateColor(value, invert);
  return (
    <motion.div
      variants={staggerItem}
      whileHover={{ y: -3 }}
      transition={{ type: 'spring', stiffness: 300, damping: 22 }}
      className="group relative overflow-hidden rounded-2xl border border-[#E5E5E5] bg-white p-5 shadow-[0_1px_2px_rgba(25,39,53,0.04)] transition-shadow hover:shadow-[0_18px_40px_rgba(102,32,42,0.10)]"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -right-12 -top-14 h-36 w-36 rounded-full opacity-50 blur-2xl transition-opacity group-hover:opacity-80"
        style={{ background: `radial-gradient(closest-side, ${hex}55, ${hex}00 70%)` }}
      />
      <div className="relative">
        <div className="flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-[0.16em] text-ink-soft">
          <span
            aria-hidden
            className="inline-block h-1.5 w-1.5 rounded-full"
            style={{ background: hex, boxShadow: `0 0 8px ${hex}cc` }}
          />
          {label}
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className={`font-display text-3xl font-semibold tracking-tight tabular-nums ${cls}`}>
            {pct(value)}
          </span>
          <NLabel n={n} suffix={nSuffix} />
        </div>
        <div className="mt-1 text-[11.5px] leading-snug text-ink-soft">{sub}</div>
        {series.length > 1 && (
          <div className="relative mt-3 -mb-1">
            <Sparkline values={series} color={hex} height={40} />
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Quality score card — 1–5 judge dimension with a small bar.
// ─────────────────────────────────────────────────────────────────────────────
function QualityCard({
  label,
  value,
  color,
  n,
}: {
  label: string;
  value: number;
  color: string;
  n?: number;
}) {
  const fillPct = Math.max(0, Math.min(100, (value / 5) * 100));
  return (
    <motion.div
      variants={staggerItem}
      className="relative overflow-hidden rounded-xl border border-[#E5E5E5] bg-white p-4"
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink-soft">
          {label}
        </span>
        <span className="font-mono text-[11px] tabular-nums text-ink-soft">{value.toFixed(1)}</span>
      </div>
      <div className="mt-1.5 flex items-baseline gap-2">
        <span className="font-display text-2xl font-semibold tabular-nums text-ink">
          {score5(value)}
        </span>
        <NLabel n={n} />
      </div>
      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-cream">
        <motion.div
          className="h-full rounded-full"
          style={{ background: color }}
          initial={{ width: 0 }}
          animate={{ width: `${fillPct}%` }}
          transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
        />
      </div>
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Rate tile — 0–1 metric with a bar (mirrors QualityCard but for a percentage).
// ─────────────────────────────────────────────────────────────────────────────
function RateTile({
  label,
  value,
  color,
  n,
  nSuffix,
}: {
  label: string;
  value: number;
  color: string;
  n?: number;
  nSuffix?: string;
}) {
  const fillPct = Math.max(0, Math.min(100, value * 100));
  return (
    <motion.div
      variants={staggerItem}
      className="relative overflow-hidden rounded-xl border border-[#E5E5E5] bg-white p-4"
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink-soft">
          {label}
        </span>
        <span className="font-mono text-[11px] tabular-nums text-ink-soft">{value.toFixed(2)}</span>
      </div>
      <div className="mt-1.5 flex items-baseline gap-2">
        <span className="font-display text-2xl font-semibold tabular-nums text-ink">
          {pct(value)}
        </span>
        <NLabel n={n} suffix={nSuffix} />
      </div>
      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-cream">
        <motion.div
          className="h-full rounded-full"
          style={{ background: color }}
          initial={{ width: 0 }}
          animate={{ width: `${fillPct}%` }}
          transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
        />
      </div>
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Run controls — segmented offline/online + sample size + Run button.
// ─────────────────────────────────────────────────────────────────────────────
function RunControls({
  channel,
  kind,
  setKind,
  onComplete,
  setError,
}: {
  channel: Channel;
  kind: RunKind;
  setKind: (k: RunKind) => void;
  onComplete: () => void;
  setError: (s: string) => void;
}) {
  const [sample, setSample] = useState(30);
  const [running, setRunning] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => {
    if (pollRef.current) clearInterval(pollRef.current);
  }, []);

  const start = useCallback(async () => {
    setError('');
    setRunning(true);
    try {
      const body: { kind: RunKind; channel: Channel; sample?: number } = { kind, channel };
      if (kind === 'online') body.sample = sample;
      const res = await adminFetch('/admin/agent-accuracy/run', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const { run_id } = (await res.json()) as { run_id: string; status: string };

      // Poll /summary (this channel) every 5s for up to ~60s for the run to land.
      let elapsed = 0;
      pollRef.current = setInterval(async () => {
        elapsed += 5;
        try {
          const sres = await adminFetch(
            `/admin/agent-accuracy/summary?channel=${encodeURIComponent(channel)}`,
          );
          if (sres.ok) {
            const data = (await sres.json()) as SummaryResp;
            if (data.latest && data.latest.run_id === run_id) {
              if (pollRef.current) clearInterval(pollRef.current);
              setRunning(false);
              onComplete();
              return;
            }
          }
        } catch {
          /* keep polling */
        }
        if (elapsed >= 60) {
          if (pollRef.current) clearInterval(pollRef.current);
          setRunning(false);
          // The run may still be in flight server-side; refresh what we have.
          onComplete();
        }
      }, 5000);
    } catch {
      setRunning(false);
      setError('Could not start the evaluation run.');
    }
  }, [kind, sample, channel, onComplete, setError]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div
        role="radiogroup"
        aria-label="Evaluation kind"
        className="inline-flex items-center gap-0.5 rounded-full bg-cream/70 p-0.5 ring-1 ring-inset ring-[#EDE6D9]"
      >
        {(['offline', 'online'] as RunKind[]).map((k) => {
          const active = kind === k;
          return (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={running}
              onClick={() => setKind(k)}
              className={`relative inline-flex h-7 items-center justify-center rounded-full px-3 text-[12px] font-medium capitalize transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 disabled:opacity-50 ${
                active
                  ? 'bg-white text-ink shadow-[0_1px_2px_rgba(25,39,53,0.08)] ring-1 ring-inset ring-[#E5E5E5]'
                  : 'text-ink-soft hover:text-ink'
              }`}
            >
              {k}
            </button>
          );
        })}
      </div>

      <AnimatePresence initial={false}>
        {kind === 'online' && (
          <motion.label
            initial={{ opacity: 0, width: 0 }}
            animate={{ opacity: 1, width: 'auto' }}
            exit={{ opacity: 0, width: 0 }}
            className="flex items-center gap-1.5 overflow-hidden whitespace-nowrap text-[11px] font-medium text-ink-soft"
          >
            Sample
            <input
              type="number"
              min={1}
              max={500}
              value={sample}
              disabled={running}
              onChange={(e) => setSample(Math.max(1, Math.min(500, Number(e.target.value) || 1)))}
              className="h-7 w-16 rounded-md border border-[#E5E5E5] bg-white px-2 text-[12px] tabular-nums text-ink focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/25 disabled:opacity-50"
              aria-label="Online sample size"
            />
          </motion.label>
        )}
      </AnimatePresence>

      <Button onClick={start} loading={running} disabled={running} aria-label="Run evaluations">
        {!running && <LuPlay width={14} height={14} strokeWidth={2.5} />}
        {running ? 'Running…' : 'Run evals'}
      </Button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab bar (matches logs page)
// ─────────────────────────────────────────────────────────────────────────────
function TabBar({ tab, setTab }: { tab: Tab; setTab: (t: Tab) => void }) {
  const tabs: { id: Tab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'breakdowns', label: 'Breakdowns' },
    { id: 'datasets', label: 'Datasets' },
    { id: 'failures', label: 'Failures' },
  ];
  return (
    <div className="mb-5 inline-flex rounded-lg border border-[#E5E5E5] bg-white p-1">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => setTab(t.id)}
          aria-current={tab === t.id ? 'page' : undefined}
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            tab === t.id ? 'bg-brand text-white' : 'text-ink-soft hover:bg-cream'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────
export default function AgentAccuracyPage() {
  const [summary, setSummary] = useState<SummaryResp | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('overview');
  const [channel, setChannel] = useState<Channel>('chat');
  const [kind, setKind] = useState<RunKind>('offline');

  const loadSummary = useCallback(async () => {
    try {
      const res = await adminFetch(
        `/admin/agent-accuracy/summary?channel=${encodeURIComponent(channel)}`,
      );
      if (!res.ok) throw new Error(`${res.status}`);
      setSummary((await res.json()) as SummaryResp);
      setError('');
    } catch {
      setError('Failed to load agent-accuracy summary.');
    } finally {
      setLoading(false);
    }
  }, [channel]);

  useEffect(() => {
    setLoading(true);
    void loadSummary();
  }, [loadSummary]);

  const latest = summary?.latest ?? null;
  // trend arrives newest-first; chronological order for charts/sparklines.
  const chrono = useMemo(() => (summary?.trend ?? []).slice().reverse(), [summary]);

  return (
    <PageWrap max="max-w-7xl">
      <PageHeader
        title="Agent Accuracy"
        badge={<Pill tone={kind === 'online' ? 'cyan' : 'violet'}>{kind}</Pill>}
        subtitle={
          latest ? (
            <>
              Last <span className="font-semibold text-ink/80">{CHANNEL_LABELS[channel]}</span> run
              was{' '}
              <span className="font-semibold text-ink/80">
                {latest.kind === 'online' ? 'online' : 'offline'}
              </span>{' '}
              on {fmtTimestamp(latest.created_at)} · {latest.counts.conversations.toLocaleString()}{' '}
              conversations / {latest.counts.turns.toLocaleString()} turns evaluated.
            </>
          ) : (
            `LLM-as-judge evaluation of the ${CHANNEL_LABELS[channel]} across task completion, tool use and response quality.`
          )
        }
        action={
          <RunControls
            channel={channel}
            kind={kind}
            setKind={setKind}
            onComplete={loadSummary}
            setError={setError}
          />
        }
      />

      <ChannelSelector channel={channel} setChannel={setChannel} />

      {CHANNEL_NOTE[channel] && (
        <p className="-mt-2 mb-4 rounded-lg border border-[#EDE6D9] bg-cream/40 px-3 py-2 text-[11.5px] leading-relaxed text-ink-soft">
          {CHANNEL_NOTE[channel]}
        </p>
      )}

      {error && <ErrorBanner>{error}</ErrorBanner>}

      {loading ? (
        <LoadingScreen label="Loading evaluations" height={420} />
      ) : !latest ? (
        <EmptyState
          icon={<LuTarget width={22} height={22} strokeWidth={1.8} />}
          title={`No ${CHANNEL_LABELS[channel]} runs yet`}
          description="Kick off the first run with “Run evals” above — offline replays the golden set for this channel, online samples live production sessions for this channel."
        />
      ) : (
        <>
          <TabBar tab={tab} setTab={setTab} />

          {tab === 'overview' && <OverviewTab latest={latest} chrono={chrono} channel={channel} />}
          {tab === 'breakdowns' && <BreakdownsTab latest={latest} channel={channel} />}
          {tab === 'datasets' && <DatasetsTab trend={summary?.trend ?? []} />}
          {tab === 'failures' && <FailuresTab runId={latest.run_id} />}
        </>
      )}
    </PageWrap>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Channel selector — segmented control re-scoping the whole dashboard.
// ─────────────────────────────────────────────────────────────────────────────
function ChannelSelector({
  channel,
  setChannel,
}: {
  channel: Channel;
  setChannel: (c: Channel) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Agent channel"
      className="mb-5 inline-flex flex-wrap items-center gap-0.5 rounded-full bg-cream/70 p-0.5 ring-1 ring-inset ring-[#EDE6D9]"
    >
      {CHANNELS.map((c) => {
        const active = channel === c;
        return (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => setChannel(c)}
            className={`relative inline-flex h-8 items-center justify-center rounded-full px-4 text-[12.5px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 ${
              active
                ? 'bg-white text-ink shadow-[0_1px_2px_rgba(25,39,53,0.08)] ring-1 ring-inset ring-[#E5E5E5]'
                : 'text-ink-soft hover:text-ink'
            }`}
          >
            {CHANNEL_LABELS[c]}
          </button>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// OVERVIEW
// ─────────────────────────────────────────────────────────────────────────────
function OverviewTab({
  latest,
  chrono,
  channel,
}: {
  latest: RunSummary;
  chrono: RunSummary[];
  channel: Channel;
}) {
  const m = latest.metrics;
  const mc = latest.metric_counts;
  const seriesFor = (pick: (r: RunSummary) => number) => chrono.map(pick);

  const overallColor = rateColor(m.overall_pass_rate).hex;
  // Intent classification only exists for the chat graph; voice/phone agents
  // have no per-turn intent, so hide intent accuracy on those channels.
  const showIntent = channel === 'chat';

  return (
    <motion.div variants={staggerContainer} initial="initial" animate="animate" className="space-y-6">
      {/* Regression vs last run */}
      <RegressionBadge regression={latest.regression} />

      {/* What the count units mean — shown once, not on every metric */}
      <p className="-mt-2 text-[11px] leading-relaxed text-ink-soft">
        Counts explained — chats (one user message + one bot reply) · conversations (one full
        back-and-forth session) · turns (one bot reply evaluated).
      </p>

      {/* Agent accuracy over time — single prominent trend */}
      <SectionCard
        eyebrow="Trend"
        title="Agent accuracy over time"
        right={
          <span className="flex items-baseline gap-2">
            <span className="font-display text-2xl font-semibold tabular-nums text-emerald-700">
              {pct(latest.metrics.overall_pass_rate)}
            </span>
            <NLabel n={latest.metric_counts?.overall_pass_rate} />
          </span>
        }
      >
        <p className="mb-4 text-[11.5px] leading-relaxed text-ink-soft">
          Share of all chats in the test set that passed, each point is one eval run.
        </p>
        {chrono.length >= 2 ? (
          <>
            <MultiAreaChart
              days={chrono.map((r) => r.created_at)}
              series={[
                {
                  name: 'Accuracy',
                  color: C.emerald,
                  values: chrono.map((r) => Math.round(r.metrics.overall_pass_rate * 100)),
                },
              ]}
              height={260}
            />
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[12px] text-ink-soft">
              <LegendDot color={C.emerald} label="Accuracy" />
              <span className="font-mono text-[11px] tabular-nums text-ink-soft">
                {fmtShort(chrono[0].created_at)} → {fmtShort(chrono[chrono.length - 1].created_at)}
              </span>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <span className="font-display text-5xl font-semibold tabular-nums text-emerald-700">
              {pct(latest.metrics.overall_pass_rate)}
            </span>
            <NLabel n={latest.metric_counts?.overall_pass_rate} />
            <p className="mt-1 text-[12px] text-ink-soft">Line builds as more runs complete.</p>
          </div>
        )}
      </SectionCard>

      {/* Headline gauge + KPI grid */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <SectionCard
          eyebrow="Headline"
          title="Overall pass rate"
          className="lg:col-span-4"
        >
          <div className="flex flex-col items-center gap-4 py-2">
            <Gauge
              value={m.overall_pass_rate}
              label={pct(m.overall_pass_rate)}
              sub="passed"
              color={overallColor}
            />
            <NLabel n={mc?.overall_pass_rate} className="-mt-2" />
            <div className="grid w-full grid-cols-2 gap-2 text-center">
              <div className="rounded-lg border border-[#EDE6D9]/80 bg-cream/30 px-3 py-2">
                <div className="font-mono text-lg font-semibold tabular-nums text-ink">
                  {pct(m.deterministic_pass_rate)}
                </div>
                <div className="text-[10.5px] uppercase tracking-[0.12em] text-ink-soft">
                  Deterministic
                </div>
                <NLabel n={mc?.deterministic_pass_rate} className="mt-0.5 block" />
              </div>
              <div className="rounded-lg border border-[#EDE6D9]/80 bg-cream/30 px-3 py-2">
                <div className="font-mono text-lg font-semibold tabular-nums text-ink">
                  {pct(m.topic_adherence_rate)}
                </div>
                <div className="text-[10.5px] uppercase tracking-[0.12em] text-ink-soft">
                  Topic adherence
                </div>
                <NLabel n={mc?.topic_adherence_rate} className="mt-0.5 block" />
              </div>
            </div>
          </div>
        </SectionCard>

        <div className="lg:col-span-8">
          <motion.div
            variants={staggerContainer}
            className="grid h-full grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3"
          >
            <MetricKPI
              label="Overall pass"
              sub="Turns passing all gates"
              value={m.overall_pass_rate}
              series={seriesFor((r) => r.metrics.overall_pass_rate)}
              n={mc?.overall_pass_rate}
            />
            {showIntent && (
              <MetricKPI
                label="Intent accuracy"
                sub="Predicted = expected intent"
                value={m.intent_accuracy}
                series={seriesFor((r) => r.metrics.intent_accuracy)}
                n={mc?.intent_accuracy}
              />
            )}
            <MetricKPI
              label="Task completion"
              sub="Judge: task achieved"
              value={m.task_completion_rate}
              series={seriesFor((r) => r.metrics.task_completion_rate)}
              n={mc?.task_completion_rate}
            />
            <MetricKPI
              label="Containment"
              sub="Resolved without escalation"
              value={m.containment_rate}
              series={seriesFor((r) => r.metrics.containment_rate)}
              n={mc?.containment_rate}
              nSuffix="conversations"
            />
            <MetricKPI
              label="Escalation"
              sub="Handed to a human (lower is better)"
              value={m.escalation_rate}
              series={seriesFor((r) => r.metrics.escalation_rate)}
              invert
              n={mc?.escalation_rate}
              nSuffix="conversations"
            />
            <MetricKPI
              label="Hallucination"
              sub="Unfaithful claims (lower is better)"
              value={m.hallucination_rate}
              series={seriesFor((r) => r.metrics.hallucination_rate)}
              invert
              n={mc?.hallucination_rate}
            />
          </motion.div>
        </div>
      </div>

      {/* Tool-use + quality */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <SectionCard eyebrow="Tool use" title="Function-calling precision & recall" className="lg:col-span-5">
          <HBarChart
            items={[
              { label: 'Precision', value: m.tool_precision * 100, color: C.teal },
              { label: 'Recall', value: m.tool_recall * 100, color: C.gold },
              { label: 'F1', value: m.tool_f1 * 100, color: C.emerald },
            ]}
          />
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
            {mc?.tool_precision !== undefined && (
              <span className="inline-flex items-center gap-1 text-[10px] text-ink-soft">
                <span className="uppercase tracking-[0.12em]">Precision</span>
                <NLabel n={mc?.tool_precision} />
              </span>
            )}
            {mc?.tool_recall !== undefined && (
              <span className="inline-flex items-center gap-1 text-[10px] text-ink-soft">
                <span className="uppercase tracking-[0.12em]">Recall</span>
                <NLabel n={mc?.tool_recall} />
              </span>
            )}
            {mc?.tool_f1 !== undefined && (
              <span className="inline-flex items-center gap-1 text-[10px] text-ink-soft">
                <span className="uppercase tracking-[0.12em]">F1</span>
                <NLabel n={mc?.tool_f1} />
              </span>
            )}
          </div>
          <p className="mt-4 text-[11.5px] leading-relaxed text-ink-soft">
            Precision = of the tools the agent called, how many were correct. Recall = of the tools
            it should have called, how many it did. F1 balances both.
          </p>
        </SectionCard>

        <SectionCard eyebrow="Response quality" title="LLM-judge scores (1–5)" className="lg:col-span-7">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <QualityCard
              label="Faithfulness"
              value={m.faithfulness_avg}
              color={C.emerald}
              n={mc?.faithfulness_avg}
            />
            <QualityCard
              label="Relevancy"
              value={m.relevancy_avg}
              color={C.teal}
              n={mc?.relevancy_avg}
            />
            <QualityCard label="Tone" value={m.tone_avg} color={C.gold} n={mc?.tone_avg} />
          </div>
          {m.judge_agreement !== undefined && (
            <div className="mt-3">
              <RateTile
                label="Judge ↔ gold agreement"
                value={m.judge_agreement}
                color={rateColor(m.judge_agreement).hex}
                n={mc?.judge_agreement}
              />
              <p className="mt-2 text-[11.5px] leading-relaxed text-ink-soft">
                How often the AI judge matches the human-labeled gold set. Low = judge scores are
                untrustworthy.
              </p>
            </div>
          )}
          <div className="mt-4 grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-[#EDE6D9]/80 bg-cream/30 px-3 py-2">
              <div className="font-mono text-base font-semibold tabular-nums text-ink">
                {pct(m.deflection_rate)}
              </div>
              <div className="text-[10.5px] uppercase tracking-[0.12em] text-ink-soft">
                Deflection rate
              </div>
              <NLabel n={mc?.deflection_rate} suffix="conversations" className="mt-0.5 block" />
            </div>
            <div className="rounded-lg border border-[#EDE6D9]/80 bg-cream/30 px-3 py-2">
              <div className="font-mono text-base font-semibold tabular-nums text-ink">
                {pct(m.topic_adherence_rate)}
              </div>
              <div className="text-[10.5px] uppercase tracking-[0.12em] text-ink-soft">
                Topic adherence
              </div>
              <NLabel n={mc?.topic_adherence_rate} className="mt-0.5 block" />
            </div>
          </div>
        </SectionCard>
      </div>

      {/* Trend across runs */}
      <SectionCard
        eyebrow="Regression watch"
        title="Accuracy trend over runs"
        right={
          <span className="inline-flex items-center gap-1.5 rounded-full bg-cream px-2.5 py-1 text-[11px] font-mono tabular-nums text-ink/70 ring-1 ring-inset ring-[#E5E5E5]">
            <LuActivity width={12} height={12} strokeWidth={2} />
            {chrono.length} run{chrono.length === 1 ? '' : 's'}
          </span>
        }
      >
        {chrono.length > 1 ? (
          <>
            <MultiAreaChart
              days={chrono.map((r) => r.created_at)}
              series={[
                {
                  name: 'Overall pass',
                  color: C.emerald,
                  values: chrono.map((r) => Math.round(r.metrics.overall_pass_rate * 100)),
                },
                ...(showIntent
                  ? [
                      {
                        name: 'Intent accuracy',
                        color: C.gold,
                        values: chrono.map((r) => Math.round(r.metrics.intent_accuracy * 100)),
                      },
                    ]
                  : []),
                {
                  name: 'Task completion',
                  color: C.teal,
                  values: chrono.map((r) => Math.round(r.metrics.task_completion_rate * 100)),
                },
              ]}
              height={260}
            />
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[12px] text-ink-soft">
              <span className="inline-flex flex-wrap items-center gap-x-4 gap-y-1">
                <LegendDot color={C.emerald} label="Overall pass" />
                {showIntent && <LegendDot color={C.gold} label="Intent accuracy" />}
                <LegendDot color={C.teal} label="Task completion" />
              </span>
              <span className="font-mono text-[11px] tabular-nums text-ink-soft">
                {fmtShort(chrono[0].created_at)} → {fmtShort(chrono[chrono.length - 1].created_at)} ·{' '}
                {latest.model} / {latest.prompt_version}
              </span>
            </div>
          </>
        ) : (
          <p className="py-6 text-center text-sm text-ink-soft">
            Only one run so far — the trend chart appears once there are at least two runs to
            compare.
          </p>
        )}
      </SectionCard>
    </motion.div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] text-ink/75">
      <span className="h-2 w-2 rounded-full" style={{ background: color, boxShadow: `0 0 0 2px ${color}22` }} />
      <span className="font-medium">{label}</span>
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Regression vs last run — status pill + violations + headline deltas.
// ─────────────────────────────────────────────────────────────────────────────
const REGRESSION_STYLE: Record<
  RegressionStatus,
  { hex: string; bg: string; ring: string; text: string; label: string }
> = {
  pass: {
    hex: C.emerald,
    bg: 'bg-emerald-50',
    ring: 'ring-emerald-200',
    text: 'text-emerald-800',
    label: 'No regression vs last run',
  },
  warn: {
    hex: C.gold,
    bg: 'bg-amber-50',
    ring: 'ring-amber-200',
    text: 'text-amber-800',
    label: 'Minor drop vs last run',
  },
  fail: {
    hex: C.rose,
    bg: 'bg-rose-50',
    ring: 'ring-rose-200',
    text: 'text-rose-800',
    label: 'Regression vs last run',
  },
  baseline: {
    hex: '#8A8A8A',
    bg: 'bg-cream/60',
    ring: 'ring-[#E5E5E5]',
    text: 'text-ink-soft',
    label: 'First run (no baseline)',
  },
};

/** Coloured signed delta — green when improving, rose when dropping (invert-aware). */
function DeltaChip({ delta, invert = false }: { delta: number; invert?: boolean }) {
  const improving = invert ? delta < 0 : delta > 0;
  const flat = delta === 0;
  const cls = flat
    ? 'text-ink-soft'
    : improving
    ? 'text-emerald-700'
    : 'text-rose-700';
  return (
    <span className={`font-mono text-[11px] font-medium tabular-nums ${cls}`}>{fmtDelta(delta)}</span>
  );
}

function RegressionBadge({ regression }: { regression?: Regression | null }) {
  const status: RegressionStatus = regression?.status ?? 'baseline';
  const s = REGRESSION_STYLE[status];
  const violations = regression?.violations ?? [];
  const deltas = regression?.deltas ?? {};
  const headline: { key: string; invert?: boolean }[] = [
    { key: 'overall_pass_rate' },
    { key: 'faithfulness_avg' },
    { key: 'judge_agreement' },
  ];
  const headlineDeltas = headline.filter((h) => deltas[h.key] !== undefined);

  return (
    <SectionCard eyebrow="Regression watch" title="This run vs the last run">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <span
            className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[12.5px] font-semibold ring-1 ring-inset ${s.bg} ${s.ring} ${s.text}`}
          >
            <span
              aria-hidden
              className="inline-block h-2 w-2 rounded-full"
              style={{ background: s.hex, boxShadow: `0 0 8px ${s.hex}cc` }}
            />
            {s.label}
          </span>
          {regression?.baseline_created_at && (
            <span className="font-mono text-[11px] tabular-nums text-ink-soft">
              baseline · {fmtTimestamp(regression.baseline_created_at)}
            </span>
          )}
        </div>

        {headlineDeltas.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            {headlineDeltas.map((h) => (
              <span key={h.key} className="inline-flex items-center gap-1.5">
                <span className="text-[11.5px] text-ink-soft">{metricLabel(h.key)}</span>
                <DeltaChip delta={deltas[h.key]} invert={h.invert} />
              </span>
            ))}
          </div>
        )}

        {(status === 'warn' || status === 'fail') && violations.length > 0 && (
          <ul className="space-y-1.5">
            {violations.map((v, i) => (
              <li
                key={`${v.metric}-${i}`}
                className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 rounded-lg border border-rose-200/70 bg-rose-50/70 px-3 py-2 text-[12px] text-ink/80"
              >
                <span className="font-medium text-ink">{metricLabel(v.metric)}</span>
                <span className="font-mono tabular-nums text-ink-soft">
                  {fmtMetricValue(v.metric, v.baseline)} → {fmtMetricValue(v.metric, v.current)}
                </span>
                <span className="font-mono tabular-nums text-rose-700">({fmtDelta(v.delta)},</span>
                <span className="font-mono tabular-nums text-ink-soft">
                  limit {fmtDelta(v.threshold)})
                </span>
              </li>
            ))}
          </ul>
        )}

        {status === 'pass' && (
          <p className="text-[12px] leading-relaxed text-ink-soft">
            All tracked metrics held within the allowed drop versus the previous offline run.
          </p>
        )}
        {status === 'baseline' && (
          <p className="text-[12px] leading-relaxed text-ink-soft">
            No earlier offline run to compare against yet — this run becomes the baseline for the
            next one.
          </p>
        )}
      </div>
    </SectionCard>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// BREAKDOWNS
// ─────────────────────────────────────────────────────────────────────────────
function BreakdownsTab({ latest, channel }: { latest: RunSummary; channel: Channel }) {
  const b = latest.breakdowns;
  const mc = latest.metric_counts;

  const intentItems = useMemo(
    () =>
      Object.entries(b.by_intent)
        .map(([label, v]) => ({
          label,
          value: v.pass_rate * 100,
          color: rateColor(v.pass_rate).hex,
          sub: `n=${v.count}`,
        }))
        .sort((a, z) => a.value - z.value),
    [b.by_intent],
  );

  const sceneItems = useMemo(
    () =>
      Object.entries(b.by_scene)
        .map(([label, v]) => ({
          label,
          value: v.pass_rate * 100,
          color: rateColor(v.pass_rate).hex,
          sub: `n=${v.count}`,
        }))
        .sort((a, z) => a.value - z.value),
    [b.by_scene],
  );

  const splitItems = useMemo(
    () =>
      Object.entries(b.by_split ?? {})
        .map(([label, v]) => ({
          label,
          value: v.pass_rate * 100,
          color: rateColor(v.pass_rate).hex,
          sub: `n=${v.count}`,
        }))
        .sort((a, z) => a.value - z.value),
    [b.by_split],
  );

  const hasSplits = splitItems.length > 0;
  // Intent & scene only exist for the website chatbot's offline golden runs.
  // Voice/phone agents have no graph intent/scene, and online runs judge raw
  // transcripts with no labels — both would collapse to a single "unknown"
  // bucket, so we hide them instead of showing a misleading 100%-unknown bar.
  const showIntentScene = channel === 'chat' && latest.kind === 'offline';
  const hasConfusion = showIntentScene && Object.keys(b.confusion ?? {}).length > 0;

  const hiddenNote =
    channel !== 'chat'
      ? `The ${CHANNEL_LABELS[channel]} has no per-turn intent or scene labels (it is not the chat graph), so these breakdowns don’t apply.`
      : 'Intent and scene breakdowns apply to offline runs against the golden test set. Online runs judge sampled production transcripts, which aren’t labeled by intent or scene.';

  return (
    <motion.div variants={staggerContainer} initial="initial" animate="animate" className="space-y-6">
      {showIntentScene ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <SectionCard eyebrow="By intent" title="Pass rate by intent">
            {intentItems.length ? (
              <HBarChart items={intentItems} height={360} />
            ) : (
              <EmptyBlock note="No per-intent breakdown for this run." />
            )}
          </SectionCard>

          <SectionCard eyebrow="By scene" title="Pass rate by scene">
            {sceneItems.length ? (
              <HBarChart items={sceneItems} height={360} />
            ) : (
              <EmptyBlock note="No per-scene breakdown for this run." />
            )}
          </SectionCard>
        </div>
      ) : (
        <SectionCard eyebrow="Intent & scene" title="Not tracked for this view">
          <EmptyBlock note={hiddenNote} />
        </SectionCard>
      )}

      {hasSplits && (
        <SectionCard eyebrow="By test-set split" title="Pass rate by test-set split">
          <HBarChart items={splitItems} height={Math.max(180, splitItems.length * 56)} />
          <p className="mt-4 text-[11.5px] leading-relaxed text-ink-soft">
            Each split is a named subset of the golden test set — e.g. core flows, edge cases,
            safety, or turns pulled from production.
          </p>
        </SectionCard>
      )}

      {showIntentScene && (
        <SectionCard
          eyebrow="Classification"
          title="Intent confusion matrix"
          right={
            <span className="text-[11px] text-ink-soft">rows = expected · cols = predicted</span>
          }
        >
          {hasConfusion ? (
            <ConfusionMatrix matrix={b.confusion} />
          ) : (
            <EmptyBlock note="No confusion data — intents matched cleanly or none were scored." />
          )}
        </SectionCard>
      )}

      <SectionCard
        eyebrow="Performance"
        title="Response latency (ms)"
        right={<NLabel n={mc?.latency} suffix="turns" />}
      >
        <PercentileBars p50={b.latency.p50} p95={b.latency.p95} p99={b.latency.p99} />
        <p className="mt-4 text-[11.5px] text-ink-soft">
          {channel === 'chat'
            ? 'End-to-end model + tool latency per turn. p99 is the slowest 1% — watch it for outliers.'
            : 'Response latency per turn for this channel — the headline metric for voice/phone. p99 is the slowest 1%.'}
        </p>
      </SectionCard>
    </motion.div>
  );
}

function EmptyBlock({ note }: { note: string }) {
  return (
    <div className="grid place-items-center py-10 text-center text-sm text-ink-soft">{note}</div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// DATASETS — ties each run's dataset → the metrics it produced, one row per chat.
// ─────────────────────────────────────────────────────────────────────────────

/** Fetches a single run's full detail (run + turns). Tolerates a null runId. */
function useRunDetail(runId: string | undefined) {
  const [detail, setDetail] = useState<RunDetailResp | null>(null);
  const [loading, setLoading] = useState<boolean>(!!runId);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!runId) {
      setDetail(null);
      setLoading(false);
      setError('');
      return;
    }
    let alive = true;
    setLoading(true);
    setError('');
    (async () => {
      try {
        const res = await adminFetch(`/admin/agent-accuracy/runs/${encodeURIComponent(runId)}`);
        if (!res.ok) throw new Error(`${res.status}`);
        const data = (await res.json()) as RunDetailResp;
        if (alive) setDetail(data);
      } catch {
        if (alive) setError('Failed to load run detail.');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [runId]);

  return { detail, loading, error };
}

function DatasetsTab({ trend }: { trend: RunSummary[] }) {
  // `trend` arrives newest-first → first match is the most recent of each kind.
  const offlineRun = useMemo(() => trend.find((r) => r.kind === 'offline'), [trend]);
  const onlineRun = useMemo(() => trend.find((r) => r.kind === 'online'), [trend]);

  const offline = useRunDetail(offlineRun?.run_id);
  const online = useRunDetail(onlineRun?.run_id);

  return (
    <motion.div variants={staggerContainer} initial="initial" animate="animate" className="space-y-8">
      <DatasetBlock
        kind="offline"
        eyebrow="Offline (synthetic golden set)"
        summaryRun={offlineRun}
        detail={offline.detail}
        loading={offline.loading}
        error={offline.error}
      />
      <DatasetBlock
        kind="online"
        eyebrow="Online (sampled production chats)"
        summaryRun={onlineRun}
        detail={online.detail}
        loading={online.loading}
        error={online.error}
      />
    </motion.div>
  );
}

/** Distinct, sorted, non-empty split values across a set of turns. */
function distinctSplits(turns: TurnDetail[]): string[] {
  const set = new Set<string>();
  for (const t of turns) {
    if (t.split && t.split.trim()) set.add(t.split.trim());
  }
  return Array.from(set).sort();
}

function DatasetBlock({
  kind,
  eyebrow,
  summaryRun,
  detail,
  loading,
  error,
}: {
  kind: RunKind;
  eyebrow: string;
  summaryRun: RunSummary | undefined;
  detail: RunDetailResp | null;
  loading: boolean;
  error: string;
}) {
  const turns = useMemo(() => (detail?.turns ?? []).slice().sort((a, b) => a.seq - b.seq), [detail]);
  const splits = useMemo(() => distinctSplits(turns), [turns]);

  // No run of this kind exists in the trend.
  if (!summaryRun) {
    return (
      <SectionCard
        eyebrow={eyebrow}
        title={kind === 'offline' ? 'Synthetic golden test set' : 'Sampled production chats'}
      >
        <EmptyBlock
          note={
            kind === 'offline'
              ? 'No offline run yet — run the golden test set to populate this.'
              : 'No online run yet — sample production chats to populate this.'
          }
        />
      </SectionCard>
    );
  }

  const run = detail?.run ?? summaryRun;
  const m = run.metrics;
  const mc = run.metric_counts;
  const chatCount = run.counts?.turns ?? turns.length;

  // "X of N chats passed" from metric_counts when available, else count locally.
  const passDenom = mc?.overall_pass_rate ?? (turns.length || chatCount);
  const passNum = detail?.turns?.length
    ? detail.turns.filter((t) => t.passed).length
    : Math.round(m.overall_pass_rate * passDenom);

  return (
    <div className="space-y-4">
      {/* 1 — Dataset summary header */}
      <SectionCard
        eyebrow={eyebrow}
        title={kind === 'offline' ? 'Synthetic golden test set' : 'Sampled production chats'}
        right={
          <span className="font-display text-2xl font-semibold tabular-nums text-emerald-700">
            {pct(m.overall_pass_rate)}
          </span>
        }
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[12px] text-ink-soft">
          {kind === 'offline' ? (
            <>
              <span className="rounded bg-cream px-1.5 py-0.5 font-mono text-[11px] text-ink/80 ring-1 ring-inset ring-[#E5E5E5]">
                Test set {run.dataset_version || '—'}
              </span>
              <span>
                <span className="font-semibold text-ink tabular-nums">
                  {chatCount.toLocaleString()}
                </span>{' '}
                chats
              </span>
              {splits.length > 0 && (
                <span className="inline-flex flex-wrap items-center gap-1">
                  <span className="text-ink-faint">splits</span>
                  {splits.map((s) => (
                    <Pill key={s} tone="slate">
                      {s}
                    </Pill>
                  ))}
                </span>
              )}
            </>
          ) : (
            <>
              <span>
                <span className="font-semibold text-ink tabular-nums">
                  {chatCount.toLocaleString()}
                </span>{' '}
                chats
              </span>
              <span className="font-mono text-[11px] tabular-nums text-ink-faint">
                {fmtShort(run.created_at)}
              </span>
            </>
          )}
        </div>

        <p className="mt-3 text-[12.5px] leading-relaxed text-ink/80">
          {kind === 'offline' ? (
            <>
              <span className="font-semibold text-ink tabular-nums">
                {passNum.toLocaleString()}
              </span>{' '}
              of{' '}
              <span className="font-semibold text-ink tabular-nums">
                {passDenom.toLocaleString()}
              </span>{' '}
              chats passed →{' '}
              <span className="font-semibold text-emerald-700">{pct(m.overall_pass_rate)}</span>{' '}
              overall.
            </>
          ) : (
            <>
              Judged{' '}
              <span className="font-semibold text-emerald-700">{pct(m.overall_pass_rate)}</span>{' '}
              overall, hallucination{' '}
              <span className={`font-semibold ${rateColor(m.hallucination_rate, true).cls}`}>
                {pct(m.hallucination_rate)}
              </span>
              .
            </>
          )}
        </p>

        {kind === 'online' && (
          <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
            Real patient chats — transcripts shown are PHI, superadmin-only.
          </p>
        )}
      </SectionCard>

      {/* 2 + 3 — Per-chat contribution table */}
      <SectionCard
        eyebrow="Dataset → metrics"
        title="Per-chat contribution"
        right={
          turns.length > 0 ? (
            <Pill tone="slate">{turns.length.toLocaleString()} chats</Pill>
          ) : undefined
        }
      >
        <p className="mb-3 text-[11.5px] leading-relaxed text-ink-soft">
          Each row is one chat; together they produce the metrics above.
        </p>

        {loading ? (
          <LoadingScreen label="Loading chats" height={200} />
        ) : error ? (
          <ErrorBanner>{error}</ErrorBanner>
        ) : turns.length === 0 ? (
          <EmptyBlock note="This run has no per-chat detail recorded." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-left text-[13px]">
              <thead>
                <tr className="border-b border-[#EDE6D9] text-[10.5px] font-semibold uppercase tracking-[0.12em] text-ink-soft">
                  <th className="px-2 py-2 font-semibold">Chat</th>
                  <th className="px-2 py-2 font-semibold">Pass</th>
                  <th className="px-2 py-2 font-semibold">Intent</th>
                  <th className="px-2 py-2 font-semibold">Scene</th>
                  <th className="px-2 py-2 font-semibold">Judge</th>
                  <th className="px-2 py-2 font-semibold">Latency</th>
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                <DatasetRows kind={kind} turns={turns} />
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}

function DatasetRows({ kind, turns }: { kind: RunKind; turns: TurnDetail[] }) {
  const [openSeq, setOpenSeq] = useState<number | null>(null);
  return (
    <>
      {turns.map((t) => {
        const open = openSeq === t.seq;
        return (
          <DatasetRow
            key={t.seq}
            kind={kind}
            turn={t}
            open={open}
            onToggle={() => setOpenSeq(open ? null : t.seq)}
          />
        );
      })}
    </>
  );
}

/** Compact session id for online chats (no PHI in the id itself). */
function shortSession(id: string): string {
  if (!id) return '—';
  return id.length > 12 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
}

function DatasetRow({
  kind,
  turn,
  open,
  onToggle,
}: {
  kind: RunKind;
  turn: TurnDetail;
  open: boolean;
  onToggle: () => void;
}) {
  const j = turn.judge;
  const hasExpected = !!turn.expected_intent;
  const mismatch = hasExpected && turn.intent !== turn.expected_intent;
  const chatLabel =
    kind === 'offline'
      ? turn.convo_name || turn.session_id || '—'
      : shortSession(turn.session_id);

  return (
    <>
      <tr
        onClick={onToggle}
        className="cursor-pointer border-b border-[#F2EEE6] align-top transition-colors hover:bg-cream/40"
      >
        {/* Chat + split */}
        <td className="px-2 py-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className={`text-ink ${kind === 'online' ? 'font-mono text-[12px]' : 'font-medium'}`}
            >
              {chatLabel}
            </span>
            {turn.split && <Pill tone="violet">{turn.split}</Pill>}
          </div>
          <div className="mt-0.5 font-mono text-[10.5px] text-ink-faint">#{turn.seq}</div>
        </td>

        {/* Pass */}
        <td className="px-2 py-3">
          {turn.passed ? (
            <span className="inline-flex text-emerald-600" aria-label="passed">
              <LuCircleCheck width={16} height={16} strokeWidth={2.2} />
            </span>
          ) : (
            <span className="inline-flex text-rose-600" aria-label="failed">
              <LuCircleX width={16} height={16} strokeWidth={2.2} />
            </span>
          )}
        </td>

        {/* Intent */}
        <td className="px-2 py-3">
          {mismatch ? (
            <span className="inline-flex flex-wrap items-center gap-1">
              <Pill tone="slate">{turn.expected_intent || '—'}</Pill>
              <span className="text-ink-faint">→</span>
              <Pill tone="red">{turn.intent || '—'}</Pill>
            </span>
          ) : (
            <Pill tone="slate">{turn.intent || '—'}</Pill>
          )}
        </td>

        {/* Scene */}
        <td className="px-2 py-3 text-[12px] text-ink-soft">{turn.scene || '—'}</td>

        {/* Judge */}
        <td className="px-2 py-3">
          <div className="flex flex-wrap items-center gap-1">
            <Pill tone={judgeTone(j.faithfulness)}>F {j.faithfulness}</Pill>
            <Pill tone={judgeTone(j.relevancy)}>R {j.relevancy}</Pill>
            <Pill tone={judgeTone(j.tone)}>T {j.tone}</Pill>
            <span
              className={`text-[12px] ${j.topic_adherence ? 'text-emerald-600' : 'text-rose-600'}`}
              title="topic adherence"
            >
              {j.topic_adherence ? '✓' : '✗'}
            </span>
            <span
              className={`text-[12px] ${j.task_completion ? 'text-emerald-600' : 'text-rose-600'}`}
              title="task completion"
            >
              {j.task_completion ? '✓' : '✗'}
            </span>
          </div>
        </td>

        {/* Latency */}
        <td className="px-2 py-3 font-mono text-[12px] tabular-nums text-ink-soft">
          {Number.isFinite(turn.latency_ms)
            ? `${Math.round(turn.latency_ms).toLocaleString()} ms`
            : '—'}
        </td>

        <td className="px-2 py-3 text-right">
          <motion.span
            animate={{ rotate: open ? 180 : 0 }}
            transition={{ duration: 0.2 }}
            className="inline-flex text-ink-soft"
          >
            <LuChevronDown width={16} height={16} strokeWidth={2} />
          </motion.span>
        </td>
      </tr>

      <AnimatePresence initial={false}>
        {open && (
          <tr>
            <td colSpan={7} className="p-0">
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                className="overflow-hidden"
              >
                <div className="grid grid-cols-1 gap-4 border-b border-[#EDE6D9] bg-cream/30 px-3 py-4 lg:grid-cols-2">
                  <Transcript label="User said" body={turn.user_says} tone="user" />
                  <Transcript label="Assistant replied" body={turn.reply} tone="agent" />
                  <div className="lg:col-span-2">
                    <FieldLabel>Judge rationale</FieldLabel>
                    <p className="rounded-lg border border-[#E5E5E5] bg-white px-3 py-2 text-[12.5px] leading-relaxed text-ink/80">
                      {j.rationale || 'No rationale provided.'}
                    </p>
                  </div>
                  <div className="lg:col-span-2">
                    <FieldLabel>Deterministic checks</FieldLabel>
                    {turn.deterministic_scores.length ? (
                      <ul className="space-y-1.5">
                        {turn.deterministic_scores.map((d, i) => (
                          <li
                            key={`${d.name}-${i}`}
                            className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-[12.5px] ${
                              d.passed
                                ? 'border-emerald-200/70 bg-emerald-50/60'
                                : 'border-rose-200/70 bg-rose-50/70'
                            }`}
                          >
                            <span
                              className={`mt-0.5 shrink-0 ${d.passed ? 'text-emerald-600' : 'text-rose-600'}`}
                            >
                              {d.passed ? (
                                <LuCircleCheck width={14} height={14} strokeWidth={2.2} />
                              ) : (
                                <LuCircleX width={14} height={14} strokeWidth={2.2} />
                              )}
                            </span>
                            <span className="min-w-0">
                              <span
                                className={`font-medium ${d.passed ? 'text-emerald-800' : 'text-rose-800'}`}
                              >
                                {d.name}
                              </span>
                              {d.detail && <span className="ml-1.5 text-ink/70">— {d.detail}</span>}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-[12.5px] text-ink-soft">No deterministic checks recorded.</p>
                    )}
                  </div>
                </div>
              </motion.div>
            </td>
          </tr>
        )}
      </AnimatePresence>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// FAILURES
// ─────────────────────────────────────────────────────────────────────────────
function isWeak(t: TurnDetail): boolean {
  const j = t.judge;
  return (
    !t.passed ||
    j.faithfulness <= 2 ||
    j.relevancy <= 2 ||
    j.tone <= 2 ||
    !j.topic_adherence
  );
}

function judgeTone(n: number): 'green' | 'amber' | 'red' {
  if (n >= 4) return 'green';
  if (n >= 3) return 'amber';
  return 'red';
}

function FailuresTab({ runId }: { runId: string }) {
  const [detail, setDetail] = useState<RunDetailResp | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [openSeq, setOpenSeq] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    (async () => {
      try {
        const res = await adminFetch(`/admin/agent-accuracy/runs/${encodeURIComponent(runId)}`);
        if (!res.ok) throw new Error(`${res.status}`);
        const data = (await res.json()) as RunDetailResp;
        if (alive) setDetail(data);
      } catch {
        if (alive) setError('Failed to load run detail.');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [runId]);

  const failures = useMemo(
    () => (detail?.turns ?? []).filter(isWeak).sort((a, b) => a.seq - b.seq),
    [detail],
  );

  if (loading) return <LoadingScreen label="Loading failing turns" height={360} />;
  if (error) return <ErrorBanner>{error}</ErrorBanner>;
  if (!detail) return null;

  if (failures.length === 0) {
    return (
      <EmptyState
        icon={<LuCircleCheck width={22} height={22} strokeWidth={1.8} />}
        title="No failing turns"
        description="Every evaluated turn passed its deterministic checks and scored well with the judge. Nothing to debug here."
      />
    );
  }

  return (
    <motion.div variants={staggerContainer} initial="initial" animate="animate">
      <SectionCard
        eyebrow="Drill-down"
        title={`Failing & low-quality turns`}
        right={
          <Pill tone="red" dot>
            {failures.length} of {detail.turns.length}
          </Pill>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-[13px]">
            <thead>
              <tr className="border-b border-[#EDE6D9] text-[10.5px] font-semibold uppercase tracking-[0.12em] text-ink-soft">
                <th className="px-2 py-2 font-semibold">Conversation</th>
                <th className="px-2 py-2 font-semibold">Intent (exp → pred)</th>
                <th className="px-2 py-2 font-semibold">Judge</th>
                <th className="px-2 py-2 font-semibold">Latency</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {failures.map((t) => {
                const open = openSeq === t.seq;
                const mismatch = t.intent !== t.expected_intent;
                return (
                  <FailureRow
                    key={t.seq}
                    turn={t}
                    open={open}
                    mismatch={mismatch}
                    onToggle={() => setOpenSeq(open ? null : t.seq)}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </motion.div>
  );
}

function FailureRow({
  turn,
  open,
  mismatch,
  onToggle,
}: {
  turn: TurnDetail;
  open: boolean;
  mismatch: boolean;
  onToggle: () => void;
}) {
  const j = turn.judge;
  return (
    <>
      <tr
        onClick={onToggle}
        className="cursor-pointer border-b border-[#F2EEE6] align-top transition-colors hover:bg-cream/40"
      >
        <td className="px-2 py-3">
          <div className="flex items-center gap-1.5">
            <span className="font-medium text-ink">{turn.convo_name || turn.session_id}</span>
            {turn.is_production && <Pill tone="cyan">prod</Pill>}
          </div>
          <div className="mt-0.5 font-mono text-[10.5px] text-ink-faint">
            #{turn.seq} · {turn.scene || '—'}
          </div>
        </td>
        <td className="px-2 py-3">
          {mismatch ? (
            <span className="inline-flex flex-wrap items-center gap-1">
              <Pill tone="slate">{turn.expected_intent || '—'}</Pill>
              <span className="text-ink-faint">→</span>
              <Pill tone="red">{turn.intent || '—'}</Pill>
            </span>
          ) : (
            <Pill tone="slate">{turn.intent || '—'}</Pill>
          )}
        </td>
        <td className="px-2 py-3">
          <div className="flex flex-wrap items-center gap-1">
            <Pill tone={judgeTone(j.faithfulness)}>F {j.faithfulness}</Pill>
            <Pill tone={judgeTone(j.relevancy)}>R {j.relevancy}</Pill>
            <Pill tone={judgeTone(j.tone)}>T {j.tone}</Pill>
            {!j.topic_adherence && <Pill tone="amber">off-topic</Pill>}
          </div>
        </td>
        <td className="px-2 py-3 font-mono text-[12px] tabular-nums text-ink-soft">
          {Math.round(turn.latency_ms).toLocaleString()}ms
        </td>
        <td className="px-2 py-3 text-right">
          <motion.span
            animate={{ rotate: open ? 180 : 0 }}
            transition={{ duration: 0.2 }}
            className="inline-flex text-ink-soft"
          >
            <LuChevronDown width={16} height={16} strokeWidth={2} />
          </motion.span>
        </td>
      </tr>
      <AnimatePresence initial={false}>
        {open && (
          <tr>
            <td colSpan={5} className="p-0">
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                className="overflow-hidden"
              >
                <div className="grid grid-cols-1 gap-4 border-b border-[#EDE6D9] bg-cream/30 px-3 py-4 lg:grid-cols-2">
                  <Transcript label="User said" body={turn.user_says} tone="user" />
                  <Transcript label="Assistant replied" body={turn.reply} tone="agent" />
                  <div className="lg:col-span-2">
                    <FieldLabel>Judge rationale</FieldLabel>
                    <p className="rounded-lg border border-[#E5E5E5] bg-white px-3 py-2 text-[12.5px] leading-relaxed text-ink/80">
                      {j.rationale || 'No rationale provided.'}
                    </p>
                  </div>
                  <div className="lg:col-span-2">
                    <FieldLabel>Deterministic checks</FieldLabel>
                    {turn.deterministic_scores.length ? (
                      <ul className="space-y-1.5">
                        {turn.deterministic_scores.map((d, i) => (
                          <li
                            key={`${d.name}-${i}`}
                            className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-[12.5px] ${
                              d.passed
                                ? 'border-emerald-200/70 bg-emerald-50/60'
                                : 'border-rose-200/70 bg-rose-50/70'
                            }`}
                          >
                            <span className={`mt-0.5 shrink-0 ${d.passed ? 'text-emerald-600' : 'text-rose-600'}`}>
                              {d.passed ? (
                                <LuCircleCheck width={14} height={14} strokeWidth={2.2} />
                              ) : (
                                <LuCircleX width={14} height={14} strokeWidth={2.2} />
                              )}
                            </span>
                            <span className="min-w-0">
                              <span className={`font-medium ${d.passed ? 'text-emerald-800' : 'text-rose-800'}`}>
                                {d.name}
                              </span>
                              {d.detail && <span className="ml-1.5 text-ink/70">— {d.detail}</span>}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-[12.5px] text-ink-soft">No deterministic checks recorded.</p>
                    )}
                  </div>
                </div>
              </motion.div>
            </td>
          </tr>
        )}
      </AnimatePresence>
    </>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-soft">
      {children}
    </div>
  );
}

function Transcript({ label, body, tone }: { label: string; body: string; tone: 'user' | 'agent' }) {
  const [expanded, setExpanded] = useState(false);
  const long = body.length > 280;
  const shown = !long || expanded ? body : `${body.slice(0, 280)}…`;
  return (
    <div className="min-w-0">
      <FieldLabel>{label}</FieldLabel>
      <div
        className={`rounded-lg border px-3 py-2 text-[12.5px] leading-relaxed ${
          tone === 'user'
            ? 'border-[#E5E5E5] bg-white text-ink/80'
            : 'border-brand-200/70 bg-brand-50/40 text-ink/85'
        }`}
      >
        <p className="whitespace-pre-wrap break-words">{shown || '—'}</p>
        {long && (
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className="mt-1.5 text-[11.5px] font-medium text-brand-700 hover:underline underline-offset-4"
          >
            {expanded ? 'Show less' : 'Show more'}
          </button>
        )}
      </div>
    </div>
  );
}
