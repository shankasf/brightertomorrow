'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { adminFetch } from '@/components/admin/useAdminAuth';
import {
  PageHeader,
  PageWrap,
  ErrorBanner,
  Button,
  LoadingScreen,
  staggerContainer,
  staggerItem,
} from '@/components/admin/ui';
import {
  MultiAreaChart,
  Donut,
  Sparkline,
} from '@/components/admin/charts';
import {
  LuPhone,
  LuMic,
  LuMessageSquare,
  LuCalendarCheck,
  LuShieldCheck,
  LuClock,
  LuActivity,
  LuRefreshCw,
  LuUsers,
  LuTrendingUp,
} from 'react-icons/lu';

// ─────────────────────────────────────────────────────────────────────────────
// Stats — mirrors gateway/internal/handlers/admin_stats.go exactly.
// Plain-English keys so the dashboard can render labels directly.
// ─────────────────────────────────────────────────────────────────────────────
type ChannelStats = { total: number; today: number; active_now: number };
type ContactsStats = { total: number; today: number };

type Stats = {
  contacts: ContactsStats;
  phone_calls: ChannelStats;
  voice_chatbot: ChannelStats;
  text_chatbot: ChannelStats;
  appointments: {
    total: number;
    today: number;
    by_status: {
      eligible: number;
      self_pay: number;
      needs_review: number;
      verification_error: number;
    };
  };
  callbacks: { total: number; today: number };
  newsletter: { total: number; active: number };
  compliance: { purge_queue_size: number };
  series: {
    days: string[];
    contacts: number[];
    phone_calls: number[];
    voice_chatbot: number[];
    text_chatbot: number[];
    appointments: number[];
  };
};

// Brand palette (mirrors tailwind.config.ts).
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

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function darken(hex: string): string {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return hex;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const s = 0.78;
  const toHex = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n * s))).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function deltaPct(arr: number[]): number {
  if (arr.length < 2) return 0;
  const half = Math.floor(arr.length / 2);
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const recent = sum(arr.slice(half));
  const prior = sum(arr.slice(0, half));
  if (prior === 0) return recent === 0 ? 0 : 100;
  return Math.round(((recent - prior) / prior) * 100);
}

// ─────────────────────────────────────────────────────────────────────────────
// KPI ribbon card
// ─────────────────────────────────────────────────────────────────────────────

function MiniKPI({
  label,
  sub,
  value,
  today,
  liveCount,
  delta,
  series,
  color,
  href,
  icon,
}: {
  label: string;
  sub: string;
  value: number | string;
  today?: number;
  liveCount?: number;
  delta?: { value: number; positive?: boolean };
  series?: number[];
  color: string;
  href?: string;
  icon: React.ReactNode;
}) {
  const card = (
    <motion.div
      variants={staggerItem}
      whileHover={{ y: -3 }}
      transition={{ type: 'spring', stiffness: 300, damping: 22 }}
      className="group relative overflow-hidden rounded-2xl border border-[#E5E5E5] bg-white p-5 shadow-[0_1px_2px_rgba(25,39,53,0.04)] transition-shadow hover:shadow-[0_18px_40px_rgba(102,32,42,0.10)]"
    >
      {/* Tinted glow tied to series color */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-12 -top-14 h-36 w-36 rounded-full opacity-60 blur-2xl transition-opacity group-hover:opacity-90"
        style={{ background: `radial-gradient(closest-side, ${color}55, ${color}00 70%)` }}
      />

      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-[0.16em] text-ink-soft">
            <span
              aria-hidden
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{ background: color, boxShadow: `0 0 8px ${color}cc` }}
            />
            {label}
            {liveCount !== undefined && liveCount > 0 && (
              <span
                aria-label={`${liveCount} live now`}
                className="ml-1 inline-flex items-center gap-1 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[9.5px] font-semibold normal-case tracking-normal text-emerald-700 ring-1 ring-inset ring-emerald-200/70"
              >
                <span className="relative inline-flex h-1.5 w-1.5">
                  <span className="absolute inset-0 animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                </span>
                {liveCount} live
              </span>
            )}
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <div className="font-display text-3xl font-semibold tracking-tight tabular-nums text-ink">
              {typeof value === 'number' ? value.toLocaleString() : value}
            </div>
            {delta && (
              <span
                className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10.5px] font-semibold tabular-nums ${
                  delta.positive
                    ? 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200/70'
                    : 'bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200/70'
                }`}
                title="Second half of the window vs the first half"
              >
                {delta.positive ? '▲' : '▼'} {delta.value}%
              </span>
            )}
          </div>
          <div className="mt-1 text-[11.5px] leading-snug text-ink-soft">{sub}</div>
        </div>
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white shadow-sm"
          style={{ background: `linear-gradient(135deg, ${color}, ${darken(color)})` }}
        >
          {icon}
        </div>
      </div>

      {series && series.length > 1 && (
        <div className="relative mt-3 -mb-1">
          <Sparkline values={series} color={color} height={42} />
        </div>
      )}

      {today !== undefined && (
        <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-cream/70 px-2 py-0.5 text-[11px] font-medium text-ink/75 ring-1 ring-inset ring-[#EDE6D9]">
          <span className="font-mono tabular-nums font-semibold text-ink">{today}</span>
          today
        </div>
      )}
    </motion.div>
  );

  return href ? (
    <Link href={href} className="block">
      {card}
    </Link>
  ) : (
    card
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Derived stat tile (smaller, computed KPIs)
// ─────────────────────────────────────────────────────────────────────────────

function DerivedStat({
  label,
  sub,
  value,
  footnote,
  tone = 'neutral',
  icon,
  href,
  pulse,
}: {
  label: string;
  sub: string;
  value: string;
  footnote?: string;
  tone?: 'neutral' | 'emerald' | 'amber' | 'quiet';
  icon: React.ReactNode;
  href?: string;
  pulse?: boolean;
}) {
  const toneRing = {
    neutral: 'ring-[#EDE6D9]',
    emerald: 'ring-emerald-200/70',
    amber: 'ring-amber-200/70',
    quiet: 'ring-[#E5E5E5]',
  }[tone];
  const toneIcon = {
    neutral: 'bg-brand-50 text-brand-700',
    emerald: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-700',
    quiet: 'bg-ink-soft/10 text-ink-soft',
  }[tone];

  const inner = (
    <motion.div
      variants={staggerItem}
      whileHover={{ y: -2 }}
      className={`group relative flex h-full items-start gap-3 overflow-hidden rounded-xl border border-[#E5E5E5] bg-white p-4 shadow-[0_1px_2px_rgba(25,39,53,0.03)] ring-1 ring-inset ${toneRing} transition-shadow hover:shadow-[0_10px_24px_rgba(25,39,53,0.07)]`}
    >
      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${toneIcon}`}>
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink-soft">
          {label}
          {pulse && (
            <span className="relative inline-flex h-2 w-2">
              <span className="absolute inset-0 animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
          )}
        </div>
        <div className="mt-1 font-display text-2xl font-semibold tracking-tight tabular-nums text-ink">
          {value}
        </div>
        <div className="mt-0.5 text-[11.5px] leading-snug text-ink-soft">{sub}</div>
        {footnote && (
          <div className="mt-1 font-mono text-[10.5px] tabular-nums text-ink-soft/80">
            {footnote}
          </div>
        )}
      </div>
    </motion.div>
  );

  return href ? (
    <Link href={href} className="block h-full">
      {inner}
    </Link>
  ) : (
    inner
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Chart card shell
// ─────────────────────────────────────────────────────────────────────────────

function ChartCard({
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

function Legend({
  items,
}: {
  items: { color: string; label: string; value?: string | number }[];
}) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
      {items.map((it) => (
        <li key={it.label} className="inline-flex items-center gap-1.5 text-[12px] text-ink/75">
          <span
            className="h-2 w-2 rounded-full"
            style={{ background: it.color, boxShadow: `0 0 0 2px ${it.color}22` }}
          />
          <span className="font-medium">{it.label}</span>
          {it.value !== undefined && (
            <span className="font-mono text-[11px] tabular-nums text-ink-soft">{it.value}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Booking quality tile
// ─────────────────────────────────────────────────────────────────────────────

function BookingQualityTile({
  label,
  value,
  total,
  color,
  sub,
}: {
  label: string;
  value: number;
  total: number;
  color: string;
  sub: string;
}) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <motion.div
      variants={staggerItem}
      className="relative overflow-hidden rounded-xl border border-[#E5E5E5] bg-white p-4"
    >
      <div className="flex items-baseline justify-between gap-2">
        <div className="flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink-soft">
          <span
            className="inline-block h-1.5 w-1.5 rounded-full"
            style={{ background: color, boxShadow: `0 0 8px ${color}cc` }}
          />
          {label}
        </div>
        <span className="font-mono text-[11px] tabular-nums text-ink-soft">{pct}%</span>
      </div>
      <div className="mt-1.5 font-display text-2xl font-semibold tabular-nums text-ink">
        {value.toLocaleString()}
      </div>
      <div className="mt-0.5 text-[11.5px] leading-snug text-ink-soft">{sub}</div>
      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-cream">
        <motion.div
          className="h-full rounded-full"
          style={{ background: color }}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
        />
      </div>
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// "Today at a glance" tile — today's count + delta vs daily average across the
// selected window. Two variants: with avgPerDay (computes ▲/▼ % vs typical)
// or with rawTotal (shows window total when no per-day series exists).
// ─────────────────────────────────────────────────────────────────────────────

function TodayTile({
  label,
  today,
  avgPerDay,
  rawTotal,
  color,
  rangeLabel,
}: {
  label: string;
  today: number;
  avgPerDay?: number;
  rawTotal?: number;
  color: string;
  rangeLabel: string;
}) {
  let deltaPct: number | null = null;
  if (avgPerDay !== undefined && avgPerDay > 0) {
    deltaPct = Math.round(((today - avgPerDay) / avgPerDay) * 100);
  } else if (avgPerDay !== undefined && avgPerDay === 0 && today > 0) {
    deltaPct = 100;
  }
  const up = (deltaPct ?? 0) >= 0;
  return (
    <div className="relative overflow-hidden rounded-xl border border-[#EDE6D9]/80 bg-white p-4 shadow-[0_1px_2px_rgba(25,39,53,0.04)]">
      <div className="flex items-start justify-between gap-2">
        <div className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink-soft">
          {label}
        </div>
        <span
          className="inline-block h-1.5 w-1.5 rounded-full"
          style={{ background: color, boxShadow: `0 0 6px ${color}cc` }}
          aria-hidden
        />
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <div className="font-display text-3xl font-semibold tabular-nums text-ink">
          {today.toLocaleString()}
        </div>
        {deltaPct !== null && (
          <span
            className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10.5px] font-semibold tabular-nums ${
              up
                ? 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200/70'
                : 'bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200/70'
            }`}
            title={`vs ${avgPerDay?.toFixed(1)}/day average over ${rangeLabel}`}
          >
            {up ? '▲' : '▼'} {Math.abs(deltaPct)}%
          </span>
        )}
      </div>
      <div className="mt-1 text-[11px] text-ink-soft">
        {avgPerDay !== undefined
          ? `Typical day: ${avgPerDay.toFixed(1)} · ${rangeLabel} avg`
          : rawTotal !== undefined
          ? `${rawTotal.toLocaleString()} total over ${rangeLabel}`
          : ''}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// "Needs your attention" tile — operational backlog items. Tone reflects
// urgency: amber/rose when count > 0, quiet/emerald when 0.
// ─────────────────────────────────────────────────────────────────────────────

function AttentionTile({
  label,
  value,
  sub,
  tone,
  href,
  icon,
}: {
  label: string;
  value: number;
  sub: string;
  tone: 'amber' | 'rose' | 'quiet';
  href?: string;
  icon: React.ReactNode;
}) {
  const styles = {
    amber: {
      ring: 'border-amber-200/70 from-amber-50/70',
      iconBg: 'bg-amber-100 text-amber-700 ring-amber-200',
      pill: 'bg-amber-100 text-amber-800',
    },
    rose: {
      ring: 'border-rose-200/70 from-rose-50/70',
      iconBg: 'bg-rose-100 text-rose-700 ring-rose-200',
      pill: 'bg-rose-100 text-rose-800',
    },
    quiet: {
      ring: 'border-emerald-200/60 from-emerald-50/60',
      iconBg: 'bg-emerald-100 text-emerald-700 ring-emerald-200',
      pill: 'bg-emerald-100 text-emerald-800',
    },
  }[tone];

  const inner = (
    <motion.div
      whileHover={{ y: -2 }}
      className={`group relative flex items-start gap-3 overflow-hidden rounded-xl border ${styles.ring} bg-gradient-to-br to-white p-4 transition-shadow hover:shadow-[0_10px_24px_rgba(25,39,53,0.07)]`}
    >
      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${styles.iconBg} ring-1 ring-inset`}>
        {icon}
      </div>
      <div className="min-w-0">
        <div className="flex items-baseline gap-2">
          <div className="font-display text-2xl font-semibold tabular-nums text-ink">
            {value.toLocaleString()}
          </div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-soft">
            {label}
          </div>
        </div>
        <div className="mt-1 text-[12.5px] text-ink/70">{sub}</div>
      </div>
      {value === 0 && (
        <span className={`absolute right-3 top-3 rounded-full px-2 py-0.5 text-[10px] font-semibold ${styles.pill}`}>
          All clear
        </span>
      )}
    </motion.div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

function AttentionBadge({ count }: { count: number }) {
  const ok = count === 0;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold tracking-tight ring-1 ring-inset ${
        ok
          ? 'bg-emerald-50 text-emerald-800 ring-emerald-200/70'
          : 'bg-amber-50 text-amber-800 ring-amber-200/70'
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${ok ? 'bg-emerald-500' : 'bg-amber-500 animate-pulse'}`} />
      {ok ? 'All clear' : `${count} item${count === 1 ? '' : 's'} to review`}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Icon set
// ─────────────────────────────────────────────────────────────────────────────

const ico = {
  phone: <LuPhone width={16} height={16} strokeWidth={2} />,
  mic: <LuMic width={16} height={16} strokeWidth={2} />,
  text: <LuMessageSquare width={16} height={16} strokeWidth={2} />,
  booking: <LuCalendarCheck width={16} height={16} strokeWidth={2} />,
  verified: <LuShieldCheck width={14} height={14} strokeWidth={2} />,
  clock: <LuClock width={14} height={14} strokeWidth={2} />,
  pulse: <LuActivity width={14} height={14} strokeWidth={2} />,
  trend: <LuTrendingUp width={14} height={14} strokeWidth={2} />,
  shield: <LuShieldCheck width={16} height={16} strokeWidth={2} />,
  users: <LuUsers width={16} height={16} strokeWidth={2} />,
  refresh: <LuRefreshCw width={14} height={14} strokeWidth={2} />,
};

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

// Date-range options for the dashboard filter bar.
// Backend (`/admin/stats?days=N`) clamps to [1, 90]. "Today" maps to days=1.
const PRESET_RANGES: { value: number; label: string; pill: string }[] = [
  { value: 1,  label: 'Today',     pill: 'Today' },
  { value: 7,  label: 'Last 7d',   pill: '7d' },
  { value: 14, label: 'Last 14d',  pill: '14d' },
  { value: 30, label: 'Last 30d',  pill: '30d' },
  { value: 90, label: 'Last 90d',  pill: '90d' },
];

// Range is either a preset window (days back from today) or a fixed
// from/to range chosen via the Custom picker. The latter sends
// `?from=YYYY-MM-DD&to=YYYY-MM-DD` to the gateway.
type RangeState =
  | { kind: 'preset'; days: number }
  | { kind: 'custom'; from: string; to: string };

function rangeToQuery(r: RangeState): string {
  if (r.kind === 'custom') {
    return `from=${encodeURIComponent(r.from)}&to=${encodeURIComponent(r.to)}`;
  }
  return `days=${r.days}`;
}

function fmtPTShort(iso: string): string {
  // iso is YYYY-MM-DD; render as e.g. "May 1".
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  const date = new Date(Date.UTC(y, m - 1, d));
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    month: 'short',
    day: 'numeric',
  }).format(date);
}

function rangeLabelFor(r: RangeState): string {
  if (r.kind === 'custom') {
    return `${fmtPTShort(r.from)} – ${fmtPTShort(r.to)}`;
  }
  const p = PRESET_RANGES.find((x) => x.value === r.days);
  return p?.pill ?? `${r.days}d`;
}

export default function AdminDashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [range, setRange] = useState<RangeState>({ kind: 'preset', days: 14 });

  async function load(r: RangeState) {
    try {
      const res = await adminFetch(`/admin/stats?${rangeToQuery(r)}`);
      if (!res.ok) throw new Error(`${res.status}`);
      setStats(await res.json());
      setError('');
    } catch {
      setError('Failed to load stats');
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    setRefreshing(true);
    load(range);
  }, [range]);

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 18) return 'Good afternoon';
    return 'Good evening';
  })();

  const rangeLabel = rangeLabelFor(range);

  // Derived series, sums, week-over-week deltas
  const derived = useMemo(() => {
    if (!stats?.series) return null;
    const s = stats.series;
    const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0);
    return {
      days: s.days,
      phoneCalls: s.phone_calls,
      voiceChatbot: s.voice_chatbot,
      textChatbot: s.text_chatbot,
      appointments: s.appointments,
      totals: {
        phoneCalls: sum(s.phone_calls),
        voiceChatbot: sum(s.voice_chatbot),
        textChatbot: sum(s.text_chatbot),
        appointments: sum(s.appointments),
      },
      deltas: {
        phoneCalls: deltaPct(s.phone_calls),
        voiceChatbot: deltaPct(s.voice_chatbot),
        textChatbot: deltaPct(s.text_chatbot),
        appointments: deltaPct(s.appointments),
      },
    };
  }, [stats]);

  // AI channel origin donut (sums across 14d window)
  const channelDonut = useMemo(() => {
    if (!derived) return null;
    const segments = [
      { value: derived.totals.phoneCalls, color: C.gold, label: 'AI phone calls' },
      { value: derived.totals.voiceChatbot, color: C.teal, label: 'AI voice chats' },
      { value: derived.totals.textChatbot, color: C.wine, label: 'AI text chats' },
    ];
    const total = segments.reduce((a, b) => a + b.value, 0);
    const top = [...segments].sort((a, b) => b.value - a.value)[0];
    const share = total > 0 ? Math.round((top.value / total) * 100) : 0;
    return { segments, total, top, share };
  }, [derived]);

  // Derived KPIs
  const liveSessions = stats
    ? stats.phone_calls.active_now + stats.voice_chatbot.active_now + stats.text_chatbot.active_now
    : 0;

  const aiConversationsTotal = stats
    ? stats.phone_calls.total + stats.voice_chatbot.total + stats.text_chatbot.total
    : 0;

  const bookingConversionPct = stats && aiConversationsTotal > 0
    ? Math.round((stats.appointments.total / aiConversationsTotal) * 1000) / 10
    : 0;

  const insuranceVerifiedPct = stats && stats.appointments.total > 0
    ? Math.round(
        (stats.appointments.by_status.eligible / stats.appointments.total) * 1000,
      ) / 10
    : 0;

  return (
    <PageWrap max="max-w-7xl">
      <PageHeader title={`${greeting}.`} />

      {/* Filter bar — date-range pills + custom picker + live indicator +
          refresh. Sits at the top of the page in lieu of a subtitle so non-
          tech staff can switch windows without scrolling. */}
      <FilterBar
        range={range}
        onRangeChange={setRange}
        liveSessions={liveSessions}
        refreshing={refreshing}
        onRefresh={() => {
          setRefreshing(true);
          load(range);
        }}
      />

      {error && <ErrorBanner>{error}</ErrorBanner>}

      {stats && derived ? (
        <motion.div
          variants={staggerContainer}
          initial="initial"
          animate="animate"
          className="space-y-6"
        >
          {/* ── KPI ribbon ─────────────────────────────────────────── */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MiniKPI
              label="AI phone calls"
              sub="Twilio number, answered by AI"
              value={stats.phone_calls.total}
              today={stats.phone_calls.today}
              liveCount={stats.phone_calls.active_now}
              delta={{
                value: Math.abs(derived.deltas.phoneCalls),
                positive: derived.deltas.phoneCalls >= 0,
              }}
              series={derived.phoneCalls}
              color={C.gold}
              icon={ico.phone}
              href="/admin/chat?source=voice-phone"
            />
            <MiniKPI
              label="AI voice chats"
              sub="Website mic widget"
              value={stats.voice_chatbot.total}
              today={stats.voice_chatbot.today}
              liveCount={stats.voice_chatbot.active_now}
              delta={{
                value: Math.abs(derived.deltas.voiceChatbot),
                positive: derived.deltas.voiceChatbot >= 0,
              }}
              series={derived.voiceChatbot}
              color={C.teal}
              icon={ico.mic}
              href="/admin/chat?source=voice-agent"
            />
            <MiniKPI
              label="AI text chats"
              sub="Website chat bubble"
              value={stats.text_chatbot.total}
              today={stats.text_chatbot.today}
              liveCount={stats.text_chatbot.active_now}
              delta={{
                value: Math.abs(derived.deltas.textChatbot),
                positive: derived.deltas.textChatbot >= 0,
              }}
              series={derived.textChatbot}
              color={C.wine}
              icon={ico.text}
              href="/admin/chat?source=chat-agent"
            />
            <MiniKPI
              label="Appointments booked"
              sub="Intakes ready in calendar"
              value={stats.appointments.total}
              today={stats.appointments.today}
              delta={{
                value: Math.abs(derived.deltas.appointments),
                positive: derived.deltas.appointments >= 0,
              }}
              series={derived.appointments}
              color={C.emerald}
              icon={ico.booking}
              href="/admin/appointments"
            />
          </div>

          {/* ── Derived KPI strip ──────────────────────────────────── */}
          <motion.div
            variants={staggerContainer}
            className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4"
          >
            <DerivedStat
              label="Bookings per AI conversation"
              sub="Across all AI channels"
              value={`${bookingConversionPct.toFixed(1)}%`}
              footnote={`${stats.appointments.total.toLocaleString()} of ${aiConversationsTotal.toLocaleString()} AI conversations`}
              tone="neutral"
              icon={ico.trend}
            />
            <DerivedStat
              label="Insurance verified rate"
              sub="Eligible vs all bookings"
              value={`${insuranceVerifiedPct.toFixed(1)}%`}
              footnote={`${stats.appointments.by_status.eligible.toLocaleString()} of ${stats.appointments.total.toLocaleString()} bookings`}
              tone="emerald"
              icon={ico.verified}
              href="/admin/appointments"
            />
            <DerivedStat
              label="On the line right now"
              sub={
                liveSessions > 0
                  ? 'Patients in an AI session this moment'
                  : 'No AI sessions live right now'
              }
              value={liveSessions > 0 ? String(liveSessions) : 'Quiet'}
              footnote={
                liveSessions > 0
                  ? `Phone ${stats.phone_calls.active_now} · Voice ${stats.voice_chatbot.active_now} · Text ${stats.text_chatbot.active_now}`
                  : undefined
              }
              tone={liveSessions > 0 ? 'emerald' : 'quiet'}
              icon={ico.pulse}
              pulse={liveSessions > 0}
              href="/admin/chat"
            />
            <DerivedStat
              label="Callback requests waiting"
              sub="Need a human to call back"
              value={stats.callbacks.total.toLocaleString()}
              footnote={`${stats.callbacks.today} today`}
              tone={stats.callbacks.total > 0 ? 'amber' : 'quiet'}
              icon={ico.clock}
              href="/admin/callbacks"
            />
          </motion.div>

          {/* ── Main chart + AI channel donut ──────────────────────── */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
            <ChartCard
              eyebrow="Daily activity"
              title={`Daily AI activity, last ${rangeLabel}`}
              className="lg:col-span-8"
              right={
                <Legend
                  items={[
                    { color: C.gold, label: 'AI phone calls', value: derived.totals.phoneCalls },
                    { color: C.teal, label: 'AI voice chats', value: derived.totals.voiceChatbot },
                    { color: C.wine, label: 'AI text chats', value: derived.totals.textChatbot },
                    { color: C.emerald, label: 'Appointments', value: derived.totals.appointments },
                  ]}
                />
              }
            >
              <MultiAreaChart
                days={derived.days}
                series={[
                  { name: 'AI phone calls', color: C.gold, values: derived.phoneCalls },
                  { name: 'AI voice chats', color: C.teal, values: derived.voiceChatbot },
                  { name: 'AI text chats', color: C.wine, values: derived.textChatbot },
                  { name: 'Appointments', color: C.emerald, values: derived.appointments },
                ]}
              />
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[12px] text-ink-soft">
                <span>
                  Today:{' '}
                  <span className="font-mono font-semibold text-ink">
                    {stats.phone_calls.today + stats.voice_chatbot.today + stats.text_chatbot.today}
                  </span>{' '}
                  AI conversation
                  {stats.phone_calls.today + stats.voice_chatbot.today + stats.text_chatbot.today === 1
                    ? ''
                    : 's'}{' '}
                  ·{' '}
                  <span className="font-mono font-semibold text-ink">
                    {stats.appointments.today}
                  </span>{' '}
                  appointment{stats.appointments.today === 1 ? '' : 's'} booked
                </span>
                <Link
                  href="/admin/chat"
                  className="font-medium text-brand-700 hover:underline underline-offset-4"
                >
                  Open AI sessions →
                </Link>
              </div>
            </ChartCard>

            <ChartCard
              eyebrow="Channel mix"
              title="Where AI conversations come from"
              className="lg:col-span-4"
            >
              <div className="flex items-center justify-center pt-1">
                <Donut
                  segments={channelDonut?.segments ?? []}
                  centerLabel={channelDonut ? `${channelDonut.share}%` : '—'}
                  centerSub={channelDonut?.top.label ?? 'No data'}
                />
              </div>
              <ul className="mt-4 space-y-2">
                {channelDonut?.segments.map((s) => {
                  const pct = channelDonut.total > 0
                    ? Math.round((s.value / channelDonut.total) * 100)
                    : 0;
                  return (
                    <li
                      key={s.label}
                      className="flex items-center justify-between rounded-lg border border-[#EDE6D9]/80 bg-cream/30 px-3 py-2"
                    >
                      <span className="inline-flex items-center gap-2 text-[12.5px] text-ink/80">
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ background: s.color, boxShadow: `0 0 0 2px ${s.color}22` }}
                        />
                        <span className="font-medium">{s.label}</span>
                      </span>
                      <span className="inline-flex items-baseline gap-2">
                        <span className="font-mono text-[11px] tabular-nums text-ink-soft">
                          {pct}%
                        </span>
                        <span className="font-mono text-[12.5px] tabular-nums font-semibold text-ink">
                          {s.value.toLocaleString()}
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </ChartCard>
          </div>

          {/* ── Booking quality strip ──────────────────────────────── */}
          <ChartCard
            eyebrow="Booking quality"
            title="How healthy are the bookings?"
            right={
              <span className="inline-flex items-center gap-1.5 rounded-full bg-cream px-2.5 py-1 text-[11px] font-mono tabular-nums text-ink/70 ring-1 ring-inset ring-[#E5E5E5]">
                {ico.booking}
                Σ {stats.appointments.total.toLocaleString()} in {rangeLabel}
              </span>
            }
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <BookingQualityTile
                label="Insurance verified"
                value={stats.appointments.by_status.eligible}
                total={stats.appointments.total}
                color={C.emerald}
                sub="Revenue-ready bookings"
              />
              <BookingQualityTile
                label="Self-pay"
                value={stats.appointments.by_status.self_pay}
                total={stats.appointments.total}
                color={C.teal}
                sub="Paying out of pocket"
              />
              <BookingQualityTile
                label="Needs review"
                value={stats.appointments.by_status.needs_review}
                total={stats.appointments.total}
                color={C.amber}
                sub="Manual eligibility check"
              />
              <BookingQualityTile
                label="Verification error"
                value={stats.appointments.by_status.verification_error}
                total={stats.appointments.total}
                color={C.rose}
                sub="Re-run insurance check"
              />
            </div>
          </ChartCard>

          {/* ── Website enquiries (full width) ─────────────────────── */}
          <ChartCard
            eyebrow="Website"
            title="Website enquiries"
            right={
              <span className="inline-flex items-center gap-1.5 rounded-full bg-cream px-2.5 py-1 text-[11px] font-mono tabular-nums text-ink/70 ring-1 ring-inset ring-[#E5E5E5]">
                Σ {stats.contacts.total.toLocaleString()} in {rangeLabel}
              </span>
            }
          >
            <MultiAreaChart
              days={derived.days}
              series={[
                { name: 'Website enquiries', color: C.peach, values: stats.series.contacts },
              ]}
              height={200}
            />
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[12px] text-ink-soft">
              <span>
                Today:{' '}
                <span className="font-mono font-semibold text-ink">
                  {stats.contacts.today}
                </span>{' '}
                new enquir{stats.contacts.today === 1 ? 'y' : 'ies'} from the website form
              </span>
              <Link
                href="/admin/contacts"
                className="font-medium text-brand-700 hover:underline underline-offset-4"
              >
                Open enquiries →
              </Link>
            </div>
          </ChartCard>

          {/* ── Today at a glance — today vs daily average ─────────── */}
          <ChartCard eyebrow="Today vs typical" title="Today at a glance">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <TodayTile
                label="AI conversations today"
                today={stats.phone_calls.today + stats.voice_chatbot.today + stats.text_chatbot.today}
                avgPerDay={(derived.totals.phoneCalls + derived.totals.voiceChatbot + derived.totals.textChatbot) / Math.max(1, derived.days.length)}
                color={C.gold}
                rangeLabel={rangeLabel}
              />
              <TodayTile
                label="Appointments today"
                today={stats.appointments.today}
                avgPerDay={derived.totals.appointments / Math.max(1, derived.days.length)}
                color={C.emerald}
                rangeLabel={rangeLabel}
              />
              <TodayTile
                label="Website enquiries today"
                today={stats.contacts.today}
                avgPerDay={stats.series.contacts.reduce((a, b) => a + b, 0) / Math.max(1, derived.days.length)}
                color={C.peach}
                rangeLabel={rangeLabel}
              />
              <TodayTile
                label="Callback requests today"
                today={stats.callbacks.today}
                rawTotal={stats.callbacks.total}
                color={C.teal}
                rangeLabel={rangeLabel}
              />
            </div>
          </ChartCard>

          {/* ── Needs your attention ───────────────────────────────── */}
          <ChartCard
            eyebrow="Operational backlog"
            title="Needs your attention"
            right={
              <AttentionBadge
                count={
                  stats.appointments.by_status.needs_review +
                  stats.appointments.by_status.verification_error +
                  stats.compliance.purge_queue_size
                }
              />
            }
          >
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <AttentionTile
                label="Insurance check pending"
                value={stats.appointments.by_status.needs_review}
                sub="Bookings waiting on manual insurance review"
                tone={stats.appointments.by_status.needs_review > 0 ? 'amber' : 'quiet'}
                href="/admin/appointments"
                icon={ico.shield}
              />
              <AttentionTile
                label="Verification errors"
                value={stats.appointments.by_status.verification_error}
                sub="Eligibility check failed — re-run or follow up"
                tone={stats.appointments.by_status.verification_error > 0 ? 'rose' : 'quiet'}
                href="/admin/appointments"
                icon={ico.shield}
              />
              <AttentionTile
                label="Records past retention"
                value={stats.compliance.purge_queue_size}
                sub={
                  stats.compliance.purge_queue_size > 0
                    ? 'Past the 10-year retention window — review & purge'
                    : 'Everything is within the retention window'
                }
                tone={stats.compliance.purge_queue_size > 0 ? 'amber' : 'quiet'}
                href="/admin/audit/purge"
                icon={ico.shield}
              />
            </div>
          </ChartCard>
        </motion.div>
      ) : !error ? (
        <LoadingScreen label="Loading dashboard" height={420} />
      ) : null}
    </PageWrap>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// FilterBar — replaces the subtitle. Date-range segmented control on the
// left; live-AI indicator + refresh on the right. Single-row professional
// view that mirrors what financial / observability dashboards use.
// ─────────────────────────────────────────────────────────────────────────────

function FilterBar({
  range,
  onRangeChange,
  liveSessions,
  refreshing,
  onRefresh,
}: {
  range: RangeState;
  onRangeChange: (r: RangeState) => void;
  liveSessions: number;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const [customOpen, setCustomOpen] = useState(false);
  const todayIso = useMemo(() => {
    const n = new Date();
    return new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()))
      .toISOString()
      .slice(0, 10);
  }, []);
  const [draftFrom, setDraftFrom] = useState<string>(
    range.kind === 'custom' ? range.from : todayIso,
  );
  const [draftTo, setDraftTo] = useState<string>(
    range.kind === 'custom' ? range.to : todayIso,
  );

  // Sync drafts when range switches externally (e.g. user clicks a preset).
  useEffect(() => {
    if (range.kind === 'custom') {
      setDraftFrom(range.from);
      setDraftTo(range.to);
    }
  }, [range]);

  const customActive = range.kind === 'custom';
  const draftValid =
    draftFrom !== '' && draftTo !== '' && draftFrom <= draftTo && draftTo <= todayIso;

  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#E5E5E5] bg-white px-3 py-2.5 shadow-[0_1px_2px_rgba(25,39,53,0.04)]"
    >
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-ink-soft">
          Date range
        </span>
        <div
          role="radiogroup"
          aria-label="Date range"
          className="inline-flex items-center gap-0.5 rounded-full bg-cream/70 p-0.5 ring-1 ring-inset ring-[#EDE6D9]"
        >
          {PRESET_RANGES.map((r) => {
            const active = range.kind === 'preset' && r.value === range.days;
            return (
              <button
                key={r.value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => onRangeChange({ kind: 'preset', days: r.value })}
                className={`relative inline-flex h-7 items-center justify-center rounded-full px-3 text-[12px] font-medium tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${
                  active
                    ? 'bg-white text-ink shadow-[0_1px_2px_rgba(25,39,53,0.08)] ring-1 ring-inset ring-[#E5E5E5]'
                    : 'text-ink-soft hover:text-ink'
                }`}
              >
                {r.pill}
              </button>
            );
          })}

          {/* Custom — opens a small popover with two date inputs. */}
          <div className="relative">
            <button
              type="button"
              aria-expanded={customOpen}
              aria-haspopup="dialog"
              onClick={() => setCustomOpen((o) => !o)}
              className={`relative inline-flex h-7 items-center justify-center gap-1 rounded-full px-3 text-[12px] font-medium tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${
                customActive
                  ? 'bg-white text-ink shadow-[0_1px_2px_rgba(25,39,53,0.08)] ring-1 ring-inset ring-[#E5E5E5]'
                  : 'text-ink-soft hover:text-ink'
              }`}
              title="Pick a custom date range"
            >
              {customActive
                ? `${fmtPTShort(range.from)} – ${fmtPTShort(range.to)}`
                : 'Custom…'}
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>

            {customOpen && (
              <>
                {/* Backdrop catches outside clicks. */}
                <div
                  className="fixed inset-0 z-30"
                  onClick={() => setCustomOpen(false)}
                  aria-hidden
                />
                <div
                  role="dialog"
                  aria-label="Custom date range"
                  className="absolute left-0 top-9 z-40 w-[280px] rounded-xl border border-[#E5E5E5] bg-white p-3 shadow-[0_18px_40px_rgba(25,39,53,0.14)]"
                >
                  <div className="grid grid-cols-2 gap-2">
                    <label className="flex flex-col gap-1">
                      <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-soft">
                        From
                      </span>
                      <input
                        type="date"
                        value={draftFrom}
                        max={draftTo || todayIso}
                        onChange={(e) => setDraftFrom(e.target.value)}
                        className="h-8 rounded-md border border-[#E5E5E5] bg-white px-2 text-[12px] tabular-nums text-ink focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-200"
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-soft">
                        To
                      </span>
                      <input
                        type="date"
                        value={draftTo}
                        min={draftFrom}
                        max={todayIso}
                        onChange={(e) => setDraftTo(e.target.value)}
                        className="h-8 rounded-md border border-[#E5E5E5] bg-white px-2 text-[12px] tabular-nums text-ink focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-200"
                      />
                    </label>
                  </div>
                  <div className="mt-2 text-[11px] text-ink-soft">
                    Window is capped at 90 days.
                  </div>
                  <div className="mt-3 flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setCustomOpen(false)}
                      className="inline-flex h-7 items-center rounded-md px-2 text-[12px] font-medium text-ink-soft transition-colors hover:bg-cream hover:text-ink"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={!draftValid}
                      onClick={() => {
                        onRangeChange({ kind: 'custom', from: draftFrom, to: draftTo });
                        setCustomOpen(false);
                      }}
                      className="inline-flex h-7 items-center rounded-md bg-ink px-3 text-[12px] font-semibold text-cream transition-colors hover:bg-ink/90 disabled:cursor-not-allowed disabled:bg-ink/40"
                    >
                      Apply
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <div
          className="hidden items-center gap-2 rounded-full border border-[#E5E5E5] bg-white px-3 py-1.5 text-[11px] font-medium text-ink-soft md:inline-flex"
          title={
            liveSessions > 0
              ? `${liveSessions} AI session${liveSessions === 1 ? '' : 's'} currently on the line`
              : 'No AI sessions currently active'
          }
        >
          {liveSessions > 0 ? (
            <>
              <span className="relative inline-flex h-2 w-2">
                <span className="absolute inset-0 animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
              Live · {liveSessions} AI session{liveSessions === 1 ? '' : 's'} on the line
            </>
          ) : (
            <>
              <span className="inline-flex h-2 w-2 rounded-full bg-ink-soft/40" />
              Quiet · no AI sessions live
            </>
          )}
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={onRefresh}
          disabled={refreshing}
          aria-label="Refresh dashboard"
        >
          {ico.refresh}
          Refresh
        </Button>
      </div>
    </motion.div>
  );
}
