'use client';
import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { adminFetch } from '@/components/admin/useAdminAuth';
import {
  PageHeader,
  PageWrap,
  Pagination,
  EmptyState,
  SkeletonRows,
  Input,
  Button,
  ErrorBanner,
  Card,
} from '@/components/admin/ui';

type ActionDetails = {
  method?: string;
  // Backend canonical key is `path_template`, but earlier builds emitted `path`.
  path_template?: string;
  path?: string;
  status?: number;
  duration_ms?: number;
} & Record<string, unknown>;

type Entry = {
  id: number;
  event_time: string;
  admin_email: string;
  action: string;
  resource_type: string;
  resource_id: string | null;
  ip_address: string | null;
  user_agent?: string | null;
  details?: ActionDetails | null;
};

type ActionKind = 'view' | 'export' | 'mutate' | 'destroy' | 'other';
type ActionFilter = 'all' | 'view' | 'export' | 'mutate' | 'destroy';

const PAGE_SIZE = 50;

/* ------------------------------------------------------------------ */
/*  describeEntry — turns a raw row into a human sentence              */
/* ------------------------------------------------------------------ */

// Special-case action → resource label. Keeps "FAQs", "PHI", "CSV" casing.
const RESOURCE_LABELS: Record<string, string> = {
  appointments: 'Appointments',
  appointment: 'Appointment',
  appointments_list: 'Appointments',
  contacts: 'Contacts',
  contacts_list: 'Contacts',
  contact: 'Contact',
  chat_sessions: 'Chat Sessions',
  chat_sessions_list: 'Chat Sessions',
  chat_session: 'Chat Session',
  chat: 'Chat Sessions',
  insurance_checks: 'Insurance Checks',
  insurance_checks_list: 'Insurance Checks',
  insurance_check: 'Insurance Check',
  callbacks: 'Callback Requests',
  callbacks_list: 'Callback Requests',
  callback: 'Callback Request',
  newsletter: 'Newsletter Subscribers',
  newsletter_list: 'Newsletter Subscribers',
  faq: 'FAQ',
  faqs: 'FAQs',
  faqs_list: 'FAQs',
  blog: 'Blog Post',
  blog_posts: 'Blog Posts',
  blog_post: 'Blog Post',
  team: 'Team Member',
  team_members: 'Team',
  services: 'Services',
  service: 'Service',
  testimonials: 'Testimonials',
  testimonial: 'Testimonial',
  locations: 'Locations',
  location: 'Location',
  site_settings: 'Site Settings',
  settings: 'Settings',
  nav: 'Navigation',
  navigation: 'Navigation',
  stats: 'Stats',
  phi_audit_log: 'PHI Audit Log',
  access_log: 'Activity Log',
  activity_log: 'Activity Log',
  audit_log: 'Activity Log',
  purge_queue: 'Purge Queue',
  logs: 'AI Logs',
  ai_logs: 'AI Logs',
  dashboard: 'Dashboard',
};

const VERB_MAP: Record<string, { verb: string; kind: ActionKind }> = {
  view: { verb: 'viewed', kind: 'view' },
  list: { verb: 'viewed', kind: 'view' },
  read: { verb: 'viewed', kind: 'view' },
  get: { verb: 'viewed', kind: 'view' },
  show: { verb: 'viewed', kind: 'view' },
  export: { verb: 'exported', kind: 'export' },
  download: { verb: 'downloaded', kind: 'export' },
  create: { verb: 'created', kind: 'mutate' },
  add: { verb: 'created', kind: 'mutate' },
  update: { verb: 'updated', kind: 'mutate' },
  edit: { verb: 'edited', kind: 'mutate' },
  patch: { verb: 'updated', kind: 'mutate' },
  publish: { verb: 'published', kind: 'mutate' },
  unpublish: { verb: 'unpublished', kind: 'mutate' },
  resolve: { verb: 'resolved', kind: 'mutate' },
  reopen: { verb: 'reopened', kind: 'mutate' },
  reply: { verb: 'replied to', kind: 'mutate' },
  send: { verb: 'sent', kind: 'mutate' },
  approve: { verb: 'approved', kind: 'mutate' },
  reject: { verb: 'rejected', kind: 'mutate' },
  delete: { verb: 'deleted', kind: 'destroy' },
  remove: { verb: 'removed', kind: 'destroy' },
  purge: { verb: 'purged', kind: 'destroy' },
  login: { verb: 'signed in', kind: 'other' },
  logout: { verb: 'signed out', kind: 'other' },
};

const ACRONYMS = new Set(['PHI', 'FAQ', 'FAQS', 'CSV', 'AI', 'IP', 'API', 'URL', 'JSON', 'PDF']);

function titleCaseChunk(s: string): string {
  const upper = s.toUpperCase();
  if (ACRONYMS.has(upper)) return upper;
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

function humanizeResourceTokens(tokens: string[]): string {
  if (tokens.length === 0) return '';
  const joined = tokens.join('_').toLowerCase();
  if (RESOURCE_LABELS[joined]) return RESOURCE_LABELS[joined];
  // Drop trailing "list" since it's redundant ("Appointments" instead of "Appointments List").
  const trimmed =
    tokens[tokens.length - 1].toLowerCase() === 'list' ? tokens.slice(0, -1) : tokens;
  const trimmedKey = trimmed.join('_').toLowerCase();
  if (RESOURCE_LABELS[trimmedKey]) return RESOURCE_LABELS[trimmedKey];
  return trimmed.map(titleCaseChunk).join(' ');
}

function shortId(id: string): string {
  // Numeric ids → "#42". UUIDs / long strings → first 8 chars + ellipsis.
  if (/^\d+$/.test(id)) return `#${id}`;
  if (id.length <= 10) return id;
  return `${id.slice(0, 8)}…`;
}

function resourceSuffix(action: string, resource_id: string | null): string {
  if (!resource_id) return '';
  // CSV-style exports include the format in the action; don't append id.
  if (/csv|json|xlsx|pdf/i.test(action)) return '';
  return ` ${shortId(resource_id)}`;
}

function describeAction(action: string): { verb: string; resource: string; kind: ActionKind } {
  const tokens = action.split('_').filter(Boolean);
  if (tokens.length === 0) return { verb: 'performed', resource: action, kind: 'other' };

  const head = tokens[0].toLowerCase();
  const mapping = VERB_MAP[head];

  if (mapping) {
    const rest = tokens.slice(1);
    const resource = rest.length === 0 ? '' : humanizeResourceTokens(rest);
    return { verb: mapping.verb, resource, kind: mapping.kind };
  }

  // Unknown verb head — try to verb-ify it naively, then humanize the rest.
  const verb = head.endsWith('e')
    ? `${head}d`
    : head.endsWith('y')
    ? `${head.slice(0, -1)}ied`
    : `${head}ed`;
  const rest = tokens.slice(1);
  const resource = humanizeResourceTokens(rest);
  return { verb, resource, kind: 'other' };
}

function prettifyEmail(email: string): string {
  const local = email.split('@')[0] ?? email;
  const parts = local.split(/[._-]+/).filter(Boolean);
  if (parts.length === 0) return email;
  return parts.map((p) => titleCaseChunk(p)).join(' ');
}

const DATE_FMT = new Intl.DateTimeFormat('en-US', {
  weekday: 'long',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

function formatLongDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const parts = DATE_FMT.formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const weekday = get('weekday');
  const month = get('month');
  const day = get('day');
  const year = get('year');
  const hour = get('hour');
  const minute = get('minute');
  const period = get('dayPeriod').toLowerCase().replace(/\s|\./g, ''); // "PM" → "pm"
  return `${weekday} ${month} ${day} ${year} at ${hour}:${minute}${period}`;
}

function isPrivateIp(ip: string | null | undefined): boolean {
  if (!ip) return true;
  if (ip === '::1' || ip === '127.0.0.1' || ip === 'localhost') return true;
  if (/^10\./.test(ip)) return true;
  if (/^192\.168\./.test(ip)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true;
  if (/^127\./.test(ip)) return true;
  if (/^fc|^fd/i.test(ip)) return true;
  return false;
}

function describeEntry(e: Entry) {
  const { verb, resource, kind } = describeAction(e.action);
  const adminShort = prettifyEmail(e.admin_email);
  const suffix = resourceSuffix(e.action, e.resource_id);
  const labelChunk = resource ? `${resource}${suffix}` : (e.resource_type ?? '').replace(/_/g, ' ');
  const date = formatLongDateTime(e.event_time);
  const sentence = `${adminShort} ${verb} ${labelChunk} on ${date}.`;
  return { sentence, kind, adminShort, verb, labelChunk, date };
}

/* ------------------------------------------------------------------ */
/*  Visual pieces                                                      */
/* ------------------------------------------------------------------ */

const KIND_STYLES: Record<ActionKind, { dot: string; pill: string; label: string }> = {
  view:    { dot: 'bg-slate-400',   pill: 'bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-200',           label: 'view' },
  export:  { dot: 'bg-sky-500',     pill: 'bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-200/70',               label: 'export' },
  mutate:  { dot: 'bg-emerald-500', pill: 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200/70',   label: 'edit' },
  destroy: { dot: 'bg-[#66202A]',   pill: 'bg-[#fbe8eb] text-[#66202A] ring-1 ring-inset ring-[#e8c5cb]',           label: 'delete' },
  other:   { dot: 'bg-ink-faint',   pill: 'bg-cream text-ink/70 ring-1 ring-inset ring-[#D9D9D9]',                  label: 'other' },
};

// Inline neutral badge for the page header — PHIBadge would mislead because
// rows in admin_access_log do NOT contain PHI by design.
function ComplianceBadge() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-cream px-2.5 py-1 text-[11px] font-medium text-ink/70 ring-1 ring-inset ring-[#D9D9D9]">
      <svg
        width="11"
        height="11"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M12 3 4 6v6c0 5 3.5 8.5 8 9 4.5-.5 8-4 8-9V6z" />
      </svg>
      Compliance · append-only
    </span>
  );
}

function FilterBar({
  from,
  to,
  adminQ,
  actionFilter,
  onFrom,
  onTo,
  onAdminQ,
  onActionFilter,
  onReset,
}: {
  from: string;
  to: string;
  adminQ: string;
  actionFilter: ActionFilter;
  onFrom: (v: string) => void;
  onTo: (v: string) => void;
  onAdminQ: (v: string) => void;
  onActionFilter: (v: ActionFilter) => void;
  onReset: () => void;
}) {
  return (
    <Card className="mb-5" padded>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1.2fr_1fr_auto] lg:items-end">
        <label className="block">
          <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-ink/60">
            From
          </span>
          <Input type="date" value={from} onChange={(e) => onFrom(e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-ink/60">
            To
          </span>
          <Input type="date" value={to} onChange={(e) => onTo(e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-ink/60">
            Admin
          </span>
          <Input
            type="search"
            placeholder="email or name"
            value={adminQ}
            onChange={(e) => onAdminQ(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-ink/60">
            Action
          </span>
          <select
            value={actionFilter}
            onChange={(e) => onActionFilter(e.target.value as ActionFilter)}
            className="block w-full rounded-lg border border-[#E5E5E5] bg-white px-3 py-2 text-sm text-ink shadow-sm transition focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/25"
          >
            <option value="all">All actions</option>
            <option value="view">Views</option>
            <option value="export">Exports</option>
            <option value="mutate">Edits</option>
            <option value="destroy">Deletes</option>
          </select>
        </label>
        <div className="flex items-end">
          <Button variant="secondary" size="md" onClick={onReset} className="w-full lg:w-auto">
            Reset
          </Button>
        </div>
      </div>
    </Card>
  );
}

function EntryRow({ entry }: { entry: Entry }) {
  const { sentence, kind, adminShort } = describeEntry(entry);
  const style = KIND_STYLES[kind];

  const method = entry.details?.method;
  const pathTemplate = entry.details?.path_template ?? entry.details?.path;
  const status = entry.details?.status;
  const durationMs = entry.details?.duration_ms;
  const showSubline = !!(method || pathTemplate);
  const ip = entry.ip_address;
  const showIp = !!(ip && !isPrivateIp(ip));

  return (
    <motion.li
      variants={{
        initial: { opacity: 0, y: 4 },
        animate: { opacity: 1, y: 0, transition: { duration: 0.18, ease: [0.22, 1, 0.36, 1] } },
      }}
      className="relative"
    >
      <div
        className="group relative flex gap-3 overflow-hidden border border-[#E5E5E5] bg-white px-4 py-3.5 shadow-[0_1px_2px_rgba(25,39,53,0.04)] transition-colors hover:bg-cream/30"
        style={{ borderRadius: '24px 0 24px 24px' }}
      >
        {/* Left edge dot */}
        <div className="flex shrink-0 flex-col items-center pt-1.5">
          <span className={`h-2 w-2 rounded-full ${style.dot}`} aria-hidden />
          <span className="mt-1 h-full w-px bg-[#EDE6D9]" aria-hidden />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <p className="text-[14px] leading-snug text-ink">
              <span
                title={entry.admin_email}
                className="font-medium text-ink decoration-brand/40 underline-offset-2 hover:underline"
              >
                {adminShort}
              </span>
              <span className="text-ink/80">{sentence.slice(adminShort.length)}</span>
            </p>
            <span
              className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${style.pill}`}
            >
              {style.label}
            </span>
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[11.5px] text-ink-soft">
            {showSubline ? (
              <span className="truncate">
                {method && <span className="text-ink/70">{method}</span>}
                {method && pathTemplate && ' '}
                {pathTemplate && <span className="text-ink-soft">{pathTemplate}</span>}
                {typeof status === 'number' && (
                  <span className={`ml-2 ${status >= 400 ? 'text-rose-700' : 'text-emerald-700'}`}>
                    · {status}
                  </span>
                )}
                {typeof durationMs === 'number' && (
                  <span className="ml-2 text-ink-faint">· {durationMs}ms</span>
                )}
              </span>
            ) : (
              <span className="text-ink-faint">
                {entry.resource_type}
                {entry.resource_id ? ` #${entry.resource_id}` : ''}
              </span>
            )}
            {showIp && <span className="text-ink-faint">· {ip}</span>}
            <span className="ml-auto text-[10.5px] tabular-nums text-ink-faint">#{entry.id}</span>
          </div>
        </div>
      </div>
    </motion.li>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function AdminActivityLogPage() {
  const [page, setPage] = useState(1);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [adminQ, setAdminQ] = useState('');
  const [actionFilter, setActionFilter] = useState<ActionFilter>('all');

  // Debounce admin filter so typing doesn't hammer the API.
  const [debouncedAdminQ, setDebouncedAdminQ] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedAdminQ(adminQ.trim()), 250);
    return () => clearTimeout(t);
  }, [adminQ]);

  // Reset to first page whenever filters change.
  useEffect(() => {
    setPage(1);
  }, [from, to, debouncedAdminQ, actionFilter]);

  const [data, setData] = useState<{ data: Entry[]; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    setData(null);
    setError(null);
    const qs = new URLSearchParams();
    qs.set('page', String(page));
    qs.set('limit', String(PAGE_SIZE));
    if (from) qs.set('from', from);
    if (to) qs.set('to', to);
    if (debouncedAdminQ) qs.set('admin', debouncedAdminQ);

    let cancelled = false;
    adminFetch(`/admin/audit/access?${qs.toString()}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`Request failed (${r.status})`);
        return r.json() as Promise<{ data: Entry[]; total: number }>;
      })
      .then((res) => {
        if (cancelled) return;
        setData(res);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load activity log');
      });
    return () => {
      cancelled = true;
    };
  }, [page, from, to, debouncedAdminQ, reloadKey]);

  // Client-side fallback filtering — backend may not support every param yet.
  const visible = useMemo(() => {
    if (!data) return [];
    let rows = data.data;
    if (debouncedAdminQ) {
      const needle = debouncedAdminQ.toLowerCase();
      rows = rows.filter(
        (e) =>
          e.admin_email.toLowerCase().includes(needle) ||
          prettifyEmail(e.admin_email).toLowerCase().includes(needle),
      );
    }
    if (actionFilter !== 'all') {
      rows = rows.filter((e) => describeAction(e.action).kind === actionFilter);
    }
    if (from) {
      const cutoff = new Date(`${from}T00:00:00`).getTime();
      rows = rows.filter((e) => new Date(e.event_time).getTime() >= cutoff);
    }
    if (to) {
      const cutoff = new Date(`${to}T23:59:59.999`).getTime();
      rows = rows.filter((e) => new Date(e.event_time).getTime() <= cutoff);
    }
    return rows;
  }, [data, debouncedAdminQ, actionFilter, from, to]);

  const reset = () => {
    setFrom('');
    setTo('');
    setAdminQ('');
    setActionFilter('all');
    setPage(1);
  };

  return (
    <PageWrap>
      <PageHeader
        title="Activity Log"
        subtitle="Append-only record of every admin console action. HIPAA §164.312(b) — entries cannot be modified or deleted."
        badge={<ComplianceBadge />}
      />

      <FilterBar
        from={from}
        to={to}
        adminQ={adminQ}
        actionFilter={actionFilter}
        onFrom={setFrom}
        onTo={setTo}
        onAdminQ={setAdminQ}
        onActionFilter={setActionFilter}
        onReset={reset}
      />

      {error ? (
        <ErrorBanner>
          Couldn&apos;t load activity log — {error}.{' '}
          <button
            type="button"
            onClick={() => setReloadKey((k) => k + 1)}
            className="ml-1 font-medium underline underline-offset-2 hover:text-rose-900"
          >
            Retry
          </button>
        </ErrorBanner>
      ) : !data ? (
        <SkeletonRows rows={8} cols={4} label="Loading activity" />
      ) : visible.length === 0 ? (
        <EmptyState
          title="No activity recorded yet."
          description="Once admins use the console, it'll show up here."
        />
      ) : (
        <>
          <motion.ul
            initial="initial"
            animate="animate"
            variants={{ animate: { transition: { staggerChildren: 0.01 } } }}
            className="space-y-2"
            aria-label="Admin activity feed"
            aria-live="polite"
          >
            {visible.map((e) => (
              <EntryRow key={e.id} entry={e} />
            ))}
          </motion.ul>

          <Pagination page={page} total={data.total} pageSize={PAGE_SIZE} onChange={setPage} />
        </>
      )}
    </PageWrap>
  );
}
