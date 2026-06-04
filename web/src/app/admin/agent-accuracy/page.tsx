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

type RunSummary = {
  run_id: string;
  kind: RunKind;
  model: string;
  prompt_version: string;
  created_at: string; // RFC3339
  counts: { conversations: number; turns: number };
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
  };
  breakdowns: {
    by_intent: Record<string, { count: number; pass_rate: number; accuracy: number }>;
    by_scene: Record<string, { count: number; pass_rate: number }>;
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

type Tab = 'overview' | 'breakdowns' | 'failures';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const score5 = (n: number) => `${n.toFixed(1)} / 5`;

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
}: {
  label: string;
  sub: string;
  value: number; // 0–1 rate
  series: number[]; // chronological values 0–1
  invert?: boolean;
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
        <div className={`mt-2 font-display text-3xl font-semibold tracking-tight tabular-nums ${cls}`}>
          {pct(value)}
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
function QualityCard({ label, value, color }: { label: string; value: number; color: string }) {
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
      <div className="mt-1.5 font-display text-2xl font-semibold tabular-nums text-ink">
        {score5(value)}
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
  onComplete,
  setError,
}: {
  onComplete: () => void;
  setError: (s: string) => void;
}) {
  const [kind, setKind] = useState<RunKind>('offline');
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
      const body: { kind: RunKind; sample?: number } = { kind };
      if (kind === 'online') body.sample = sample;
      const res = await adminFetch('/admin/agent-accuracy/run', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const { run_id } = (await res.json()) as { run_id: string; status: string };

      // Poll /summary every 5s for up to ~60s for a newer run to land.
      let elapsed = 0;
      pollRef.current = setInterval(async () => {
        elapsed += 5;
        try {
          const sres = await adminFetch('/admin/agent-accuracy/summary');
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
  }, [kind, sample, onComplete, setError]);

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

  const loadSummary = useCallback(async () => {
    try {
      const res = await adminFetch('/admin/agent-accuracy/summary');
      if (!res.ok) throw new Error(`${res.status}`);
      setSummary((await res.json()) as SummaryResp);
      setError('');
    } catch {
      setError('Failed to load agent-accuracy summary.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  const latest = summary?.latest ?? null;
  // trend arrives newest-first; chronological order for charts/sparklines.
  const chrono = useMemo(() => (summary?.trend ?? []).slice().reverse(), [summary]);

  return (
    <PageWrap max="max-w-7xl">
      <PageHeader
        title="Agent Accuracy"
        badge={
          latest ? (
            <Pill tone={latest.kind === 'online' ? 'cyan' : 'violet'}>{latest.kind}</Pill>
          ) : undefined
        }
        subtitle={
          latest ? (
            <>
              Latest run on{' '}
              <span className="font-mono text-ink/80">{latest.model}</span> · prompt{' '}
              <span className="font-mono text-ink/80">{latest.prompt_version}</span> ·{' '}
              {fmtTimestamp(latest.created_at)} · {latest.counts.conversations.toLocaleString()}{' '}
              conversations / {latest.counts.turns.toLocaleString()} turns evaluated.
            </>
          ) : (
            'LLM-as-judge evaluation of the assistant across intents, scenes, tool use and response quality.'
          )
        }
        action={<RunControls onComplete={loadSummary} setError={setError} />}
      />

      {error && <ErrorBanner>{error}</ErrorBanner>}

      {loading ? (
        <LoadingScreen label="Loading evaluations" height={420} />
      ) : !latest ? (
        <EmptyState
          icon={<LuTarget width={22} height={22} strokeWidth={1.8} />}
          title="No evaluation runs yet"
          description="Kick off the first run to score the assistant on intent accuracy, task completion, tool use and response quality. Use “Run evals” above — offline replays the golden set, online samples live production turns."
        />
      ) : (
        <>
          <TabBar tab={tab} setTab={setTab} />

          {tab === 'overview' && <OverviewTab latest={latest} chrono={chrono} />}
          {tab === 'breakdowns' && <BreakdownsTab latest={latest} />}
          {tab === 'failures' && <FailuresTab runId={latest.run_id} />}
        </>
      )}
    </PageWrap>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// OVERVIEW
// ─────────────────────────────────────────────────────────────────────────────
function OverviewTab({ latest, chrono }: { latest: RunSummary; chrono: RunSummary[] }) {
  const m = latest.metrics;
  const seriesFor = (pick: (r: RunSummary) => number) => chrono.map(pick);

  const overallColor = rateColor(m.overall_pass_rate).hex;

  return (
    <motion.div variants={staggerContainer} initial="initial" animate="animate" className="space-y-6">
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
            <div className="grid w-full grid-cols-2 gap-2 text-center">
              <div className="rounded-lg border border-[#EDE6D9]/80 bg-cream/30 px-3 py-2">
                <div className="font-mono text-lg font-semibold tabular-nums text-ink">
                  {pct(m.deterministic_pass_rate)}
                </div>
                <div className="text-[10.5px] uppercase tracking-[0.12em] text-ink-soft">
                  Deterministic
                </div>
              </div>
              <div className="rounded-lg border border-[#EDE6D9]/80 bg-cream/30 px-3 py-2">
                <div className="font-mono text-lg font-semibold tabular-nums text-ink">
                  {pct(m.topic_adherence_rate)}
                </div>
                <div className="text-[10.5px] uppercase tracking-[0.12em] text-ink-soft">
                  Topic adherence
                </div>
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
            />
            <MetricKPI
              label="Intent accuracy"
              sub="Predicted = expected intent"
              value={m.intent_accuracy}
              series={seriesFor((r) => r.metrics.intent_accuracy)}
            />
            <MetricKPI
              label="Task completion"
              sub="Judge: task achieved"
              value={m.task_completion_rate}
              series={seriesFor((r) => r.metrics.task_completion_rate)}
            />
            <MetricKPI
              label="Containment"
              sub="Resolved without escalation"
              value={m.containment_rate}
              series={seriesFor((r) => r.metrics.containment_rate)}
            />
            <MetricKPI
              label="Escalation"
              sub="Handed to a human (lower is better)"
              value={m.escalation_rate}
              series={seriesFor((r) => r.metrics.escalation_rate)}
              invert
            />
            <MetricKPI
              label="Hallucination"
              sub="Unfaithful claims (lower is better)"
              value={m.hallucination_rate}
              series={seriesFor((r) => r.metrics.hallucination_rate)}
              invert
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
          <p className="mt-4 text-[11.5px] leading-relaxed text-ink-soft">
            Precision = of the tools the agent called, how many were correct. Recall = of the tools
            it should have called, how many it did. F1 balances both.
          </p>
        </SectionCard>

        <SectionCard eyebrow="Response quality" title="LLM-judge scores (1–5)" className="lg:col-span-7">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <QualityCard label="Faithfulness" value={m.faithfulness_avg} color={C.emerald} />
            <QualityCard label="Relevancy" value={m.relevancy_avg} color={C.teal} />
            <QualityCard label="Tone" value={m.tone_avg} color={C.gold} />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-[#EDE6D9]/80 bg-cream/30 px-3 py-2">
              <div className="font-mono text-base font-semibold tabular-nums text-ink">
                {pct(m.deflection_rate)}
              </div>
              <div className="text-[10.5px] uppercase tracking-[0.12em] text-ink-soft">
                Deflection rate
              </div>
            </div>
            <div className="rounded-lg border border-[#EDE6D9]/80 bg-cream/30 px-3 py-2">
              <div className="font-mono text-base font-semibold tabular-nums text-ink">
                {pct(m.topic_adherence_rate)}
              </div>
              <div className="text-[10.5px] uppercase tracking-[0.12em] text-ink-soft">
                Topic adherence
              </div>
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
                {
                  name: 'Intent accuracy',
                  color: C.gold,
                  values: chrono.map((r) => Math.round(r.metrics.intent_accuracy * 100)),
                },
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
                <LegendDot color={C.gold} label="Intent accuracy" />
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
// BREAKDOWNS
// ─────────────────────────────────────────────────────────────────────────────
function BreakdownsTab({ latest }: { latest: RunSummary }) {
  const b = latest.breakdowns;

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

  const hasConfusion = Object.keys(b.confusion ?? {}).length > 0;

  return (
    <motion.div variants={staggerContainer} initial="initial" animate="animate" className="space-y-6">
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

      <SectionCard eyebrow="Performance" title="Response latency (ms)">
        <PercentileBars p50={b.latency.p50} p95={b.latency.p95} p99={b.latency.p99} />
        <p className="mt-4 text-[11.5px] text-ink-soft">
          End-to-end model + tool latency per turn. p99 is the slowest 1% — watch it for outliers.
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
