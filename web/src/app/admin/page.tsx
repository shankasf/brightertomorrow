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
  BarChart,
  Sparkline,
  RadialGauge,
} from '@/components/admin/charts';

type Stats = {
  contacts: { total: number; today: number };
  chat: {
    total_sessions: number;
    active_sessions: number;
    today_sessions: number;
    total_messages: number;
  };
  newsletter: { total: number; active: number };
  content: {
    faqs: number;
    blog_posts: number;
    published_posts: number;
    team_members: number;
  };
  compliance: { purge_queue_size: number };
  series?: {
    days: string[];
    contacts: number[];
    chats: number[];
    messages: number[];
    newsletter: number[];
  };
};

// Brand palette (mirrors tailwind.config.ts)
const C = {
  gold: '#E1B878',
  gold600: '#cf9e57',
  wine: '#66202A',
  teal: '#75ACC0',
  peach: '#FFBC7D',
  navy: '#192735',
  emerald: '#3a7a5d',
};

// ─────────────────────────────────────────────────────────────────────────────

function MiniKPI({
  label,
  value,
  delta,
  series,
  color,
  href,
  icon,
}: {
  label: string;
  value: number | string;
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

      <div className="relative flex items-start justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-[0.16em] text-ink-soft">
            <span
              aria-hidden
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{ background: color, boxShadow: `0 0 8px ${color}cc` }}
            />
            {label}
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
              >
                {delta.positive ? '▲' : '▼'} {delta.value}
              </span>
            )}
          </div>
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
          <Sparkline values={series} color={color} height={42} width={260} />
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

function darken(hex: string): string {
  // Simple 10% darken via channel scale — only for inline gradients.
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return hex;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const s = 0.78;
  const toHex = (n: number) => Math.max(0, Math.min(255, Math.round(n * s))).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

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
      {/* Top hairline accent */}
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
            <span className="font-mono text-[11px] tabular-nums text-ink-soft">
              {it.value}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

// Small icon set, scoped to this page
const ico = {
  mail: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </svg>
  ),
  chat: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12a8 8 0 0 1-11.4 7.2L3 21l1.8-6.6A8 8 0 1 1 21 12z" />
    </svg>
  ),
  hash: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18" />
    </svg>
  ),
  users: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="8.5" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
    </svg>
  ),
  pulse: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12h4l3-9 4 18 3-9h4" />
    </svg>
  ),
  shield: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3 4 6v6c0 5 3.5 8.5 8 9 4.5-.5 8-4 8-9V6z" />
    </svg>
  ),
  refresh: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
      <path d="M3 21v-5h5" />
    </svg>
  ),
};

// ─────────────────────────────────────────────────────────────────────────────

export default function AdminDashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  async function load() {
    try {
      const r = await adminFetch('/admin/stats');
      if (!r.ok) throw new Error(`${r.status}`);
      setStats(await r.json());
      setError('');
    } catch {
      setError('Failed to load stats');
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 18) return 'Good afternoon';
    return 'Good evening';
  })();

  // Derived series + week-over-week deltas
  const derived = useMemo(() => {
    if (!stats?.series) return null;
    const { days, contacts, chats, messages, newsletter } = stats.series;
    const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0);
    const half = Math.floor(days.length / 2);
    const delta = (arr: number[]) => {
      const recent = sum(arr.slice(half));
      const prior = sum(arr.slice(0, half));
      if (prior === 0) return recent === 0 ? 0 : 100;
      return Math.round(((recent - prior) / prior) * 100);
    };
    return {
      days,
      contacts,
      chats,
      messages,
      newsletter,
      deltas: {
        contacts: delta(contacts),
        chats: delta(chats),
        messages: delta(messages),
        newsletter: delta(newsletter),
      },
      totals: {
        contactsWindow: sum(contacts),
        chatsWindow: sum(chats),
        messagesWindow: sum(messages),
        newsletterWindow: sum(newsletter),
      },
    };
  }, [stats]);

  // Newsletter donut
  const newsletterDonut = useMemo(() => {
    if (!stats) return null;
    const inactive = Math.max(0, stats.newsletter.total - stats.newsletter.active);
    return [
      { value: stats.newsletter.active, color: C.gold, label: 'Active' },
      { value: inactive, color: C.wine, label: 'Unsubscribed' },
    ];
  }, [stats]);

  // Content publish rate
  const publishRate = stats?.content.blog_posts
    ? stats.content.published_posts / stats.content.blog_posts
    : 0;

  return (
      <PageWrap max="max-w-7xl">
        <PageHeader
          title={`${greeting}.`}
          subtitle={
            <>
              A live picture of the practice — engagement, content, and HIPAA
              compliance — over the <span className="font-medium text-ink">last 14 days</span>.
            </>
          }
          action={
            <>
              <div className="hidden items-center gap-2 rounded-full border border-[#E5E5E5] bg-white px-3 py-1.5 text-[11px] font-medium text-ink-soft md:inline-flex">
                <span className="relative inline-flex h-2 w-2">
                  <span className="absolute inset-0 animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                </span>
                Live · {stats?.chat.active_sessions ?? 0} active session
                {stats?.chat.active_sessions === 1 ? '' : 's'}
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setRefreshing(true);
                  load();
                }}
                disabled={refreshing}
              >
                {ico.refresh}
                Refresh
              </Button>
            </>
          }
        />

        {error && <ErrorBanner>{error}</ErrorBanner>}

        {stats ? (
          <motion.div
            variants={staggerContainer}
            initial="initial"
            animate="animate"
            className="space-y-6"
          >
            {/* KPI ribbon */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <MiniKPI
                label="Contacts"
                value={stats.contacts.total}
                delta={
                  derived
                    ? {
                        value: Math.abs(derived.deltas.contacts),
                        positive: derived.deltas.contacts >= 0,
                      }
                    : undefined
                }
                series={derived?.contacts}
                color={C.gold}
                icon={ico.mail}
                href="/admin/contacts"
              />
              <MiniKPI
                label="Chat sessions"
                value={stats.chat.total_sessions}
                delta={
                  derived
                    ? {
                        value: Math.abs(derived.deltas.chats),
                        positive: derived.deltas.chats >= 0,
                      }
                    : undefined
                }
                series={derived?.chats}
                color={C.teal}
                icon={ico.chat}
                href="/admin/chat"
              />
              <MiniKPI
                label="Messages"
                value={stats.chat.total_messages}
                delta={
                  derived
                    ? {
                        value: Math.abs(derived.deltas.messages),
                        positive: derived.deltas.messages >= 0,
                      }
                    : undefined
                }
                series={derived?.messages}
                color={C.wine}
                icon={ico.hash}
              />
              <MiniKPI
                label="Newsletter"
                value={stats.newsletter.active}
                delta={
                  derived
                    ? {
                        value: Math.abs(derived.deltas.newsletter),
                        positive: derived.deltas.newsletter >= 0,
                      }
                    : undefined
                }
                series={derived?.newsletter}
                color={C.peach}
                icon={ico.users}
                href="/admin/newsletter"
              />
            </div>

            {/* Main charts row */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
              <ChartCard
                eyebrow="Engagement"
                title="Contacts & chat sessions, last 14 days"
                className="lg:col-span-8"
                right={
                  derived && (
                    <Legend
                      items={[
                        {
                          color: C.gold,
                          label: 'Contacts',
                          value: derived.totals.contactsWindow,
                        },
                        {
                          color: C.teal,
                          label: 'Chats',
                          value: derived.totals.chatsWindow,
                        },
                      ]}
                    />
                  )
                }
              >
                {derived ? (
                  <MultiAreaChart
                    days={derived.days}
                    series={[
                      { name: 'Contacts', color: C.gold, values: derived.contacts },
                      { name: 'Chats', color: C.teal, values: derived.chats },
                    ]}
                  />
                ) : (
                  <div className="grid h-[280px] place-items-center text-sm text-ink-soft">
                    No series data yet
                  </div>
                )}
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[12px] text-ink-soft">
                  <span>
                    Today:{' '}
                    <span className="font-mono font-semibold text-ink">
                      {stats.contacts.today}
                    </span>{' '}
                    contact{stats.contacts.today === 1 ? '' : 's'},{' '}
                    <span className="font-mono font-semibold text-ink">
                      {stats.chat.today_sessions}
                    </span>{' '}
                    chat{stats.chat.today_sessions === 1 ? '' : 's'}
                  </span>
                  <Link
                    href="/admin/chat"
                    className="font-medium text-brand-700 hover:underline underline-offset-4"
                  >
                    Open chat sessions →
                  </Link>
                </div>
              </ChartCard>

              <ChartCard
                eyebrow="Audience"
                title="Newsletter list health"
                className="lg:col-span-4"
              >
                <div className="flex items-center justify-center pt-1">
                  <Donut
                    segments={newsletterDonut ?? []}
                    centerLabel={`${
                      stats.newsletter.total > 0
                        ? Math.round(
                            (stats.newsletter.active / stats.newsletter.total) * 100,
                          )
                        : 0
                    }%`}
                    centerSub="Active"
                  />
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3 text-center">
                  <div className="rounded-xl border border-[#EDE6D9]/80 bg-cream/40 px-3 py-3">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-soft">
                      Active
                    </div>
                    <div className="mt-1 font-display text-xl font-semibold tabular-nums text-ink">
                      {stats.newsletter.active.toLocaleString()}
                    </div>
                  </div>
                  <div className="rounded-xl border border-[#EDE6D9]/80 bg-cream/40 px-3 py-3">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-soft">
                      Total
                    </div>
                    <div className="mt-1 font-display text-xl font-semibold tabular-nums text-ink">
                      {stats.newsletter.total.toLocaleString()}
                    </div>
                  </div>
                </div>
              </ChartCard>
            </div>

            {/* Secondary row */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
              <ChartCard
                eyebrow="Velocity"
                title="Messages per day"
                className="lg:col-span-8"
                right={
                  derived && (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-cream px-2.5 py-1 text-[11px] font-mono tabular-nums text-ink/70 ring-1 ring-inset ring-[#E5E5E5]">
                      {ico.pulse}
                      Σ {derived.totals.messagesWindow.toLocaleString()} · 14d
                    </span>
                  )
                }
              >
                {derived ? (
                  <BarChart
                    days={derived.days}
                    values={derived.messages}
                    color={C.gold}
                    accent={C.wine}
                  />
                ) : (
                  <div className="grid h-[200px] place-items-center text-sm text-ink-soft">
                    No series data yet
                  </div>
                )}
                <div className="mt-3 flex items-center justify-between text-[12px] text-ink-soft">
                  <span className="inline-flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: C.gold }} />
                    Past days
                    <span className="ml-3 h-2.5 w-2.5 rounded-full" style={{ background: C.wine }} />
                    Today
                  </span>
                  <span>
                    Avg/day:{' '}
                    <span className="font-mono font-semibold text-ink">
                      {derived
                        ? Math.round(
                            derived.totals.messagesWindow / derived.messages.length,
                          )
                        : '—'}
                    </span>
                  </span>
                </div>
              </ChartCard>

              <ChartCard
                eyebrow="Content"
                title="Library health"
                className="lg:col-span-4"
              >
                <div className="flex items-center justify-center pt-1">
                  <RadialGauge
                    value={publishRate}
                    label={`${Math.round(publishRate * 100)}%`}
                    sub="Published"
                    color={C.gold}
                    accent={C.wine}
                  />
                </div>
                <ul className="mt-4 divide-y divide-[#EDE6D9]/80 rounded-xl border border-[#EDE6D9]/80 bg-cream/30">
                  <ContentRow
                    label="FAQs"
                    value={stats.content.faqs}
                    href="/admin/content/faqs"
                  />
                  <ContentRow
                    label="Blog posts"
                    value={stats.content.blog_posts}
                    detail={`${stats.content.published_posts} live`}
                    href="/admin/content/blog"
                  />
                  <ContentRow
                    label="Team"
                    value={stats.content.team_members}
                    href="/admin/content/team"
                  />
                </ul>
              </ChartCard>
            </div>

            {/* Compliance rail */}
            <ChartCard
              eyebrow="HIPAA · Nevada NRS 629.051"
              title="Compliance posture"
              right={
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold tracking-tight ring-1 ring-inset ${
                    stats.compliance.purge_queue_size > 0
                      ? 'bg-amber-50 text-amber-800 ring-amber-200/70'
                      : 'bg-emerald-50 text-emerald-800 ring-emerald-200/70'
                  }`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      stats.compliance.purge_queue_size > 0
                        ? 'bg-amber-500 animate-pulse'
                        : 'bg-emerald-500'
                    }`}
                  />
                  {stats.compliance.purge_queue_size > 0
                    ? 'Action required'
                    : 'All clear'}
                </span>
              }
            >
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <ComplianceTile
                  icon={ico.shield}
                  label="Purge queue"
                  value={stats.compliance.purge_queue_size}
                  sub={
                    stats.compliance.purge_queue_size > 0
                      ? 'Records past 10-year retention'
                      : 'Within retention window'
                  }
                  tone={stats.compliance.purge_queue_size > 0 ? 'amber' : 'emerald'}
                  href="/admin/audit/purge"
                />
                <ComplianceTile
                  icon={ico.shield}
                  label="PHI audit"
                  value="Live"
                  sub="All PHI reads & writes logged"
                  tone="emerald"
                  href="/admin/audit/phi"
                />
                <ComplianceTile
                  icon={ico.shield}
                  label="Admin access"
                  value="Tracked"
                  sub="Every session signed & dated"
                  tone="emerald"
                  href="/admin/audit/access"
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

function ContentRow({
  label,
  value,
  detail,
  href,
}: {
  label: string;
  value: number;
  detail?: string;
  href?: string;
}) {
  const inner = (
    <div className="flex items-center justify-between px-3 py-2.5 transition-colors hover:bg-white/60">
      <span className="text-[13px] font-medium text-ink">{label}</span>
      <span className="inline-flex items-center gap-2">
        {detail && (
          <span className="text-[11px] font-medium text-ink-soft">{detail}</span>
        )}
        <span className="font-mono text-sm tabular-nums font-semibold text-ink">
          {value.toLocaleString()}
        </span>
      </span>
    </div>
  );
  return (
    <li>
      {href ? (
        <Link href={href} className="block">
          {inner}
        </Link>
      ) : (
        inner
      )}
    </li>
  );
}

function ComplianceTile({
  icon,
  label,
  value,
  sub,
  tone,
  href,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  sub: string;
  tone: 'emerald' | 'amber';
  href?: string;
}) {
  const ring =
    tone === 'amber'
      ? 'border-amber-200/70 from-amber-50/70'
      : 'border-emerald-200/60 from-emerald-50/60';
  const iconBg =
    tone === 'amber'
      ? 'bg-amber-100 text-amber-700 ring-amber-200'
      : 'bg-emerald-100 text-emerald-700 ring-emerald-200';

  const inner = (
    <motion.div
      whileHover={{ y: -2 }}
      className={`group relative flex items-start gap-3 overflow-hidden rounded-xl border ${ring} bg-gradient-to-br to-white p-4 transition-shadow hover:shadow-[0_10px_24px_rgba(25,39,53,0.07)]`}
    >
      <div
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${iconBg} ring-1 ring-inset`}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <div className="flex items-baseline gap-2">
          <div className="font-display text-2xl font-semibold tabular-nums text-ink">
            {typeof value === 'number' ? value.toLocaleString() : value}
          </div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-soft">
            {label}
          </div>
        </div>
        <div className="mt-1 text-[12.5px] text-ink/70">{sub}</div>
      </div>
    </motion.div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}
