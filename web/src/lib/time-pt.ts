// Pacific-Time renderers for the admin console.
// Brighter Tomorrow Therapy operates exclusively in PT, so every admin
// timestamp is rendered in `America/Los_Angeles` with a visible "PT"
// suffix regardless of the viewer's browser timezone. Backend stores
// ISO-8601 (mostly UTC `Z`-suffixed); these helpers normalise the
// display.

const PT_ZONE = 'America/Los_Angeles';

type Input = string | number | Date | null | undefined;

function toDate(v: Input): Date | null {
  if (v == null || v === '') return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Full "May 14, 2026, 9:30 AM PT" — for tables, lists, detail views. */
export function formatPT(iso: Input): string {
  const d = toDate(iso);
  if (!d) return '—';
  const formatted = new Intl.DateTimeFormat('en-US', {
    timeZone: PT_ZONE,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(d);
  return `${formatted} PT`;
}

/** Date-only "May 14, 2026" — no PT label needed for pure dates. */
export function formatPTDate(iso: Input): string {
  const d = toDate(iso);
  if (!d) return '—';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: PT_ZONE,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(d);
}

/** Time-only "9:30 AM PT" — for compact columns. */
export function formatPTTime(iso: Input): string {
  const d = toDate(iso);
  if (!d) return '—';
  const formatted = new Intl.DateTimeFormat('en-US', {
    timeZone: PT_ZONE,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(d);
  return `${formatted} PT`;
}

/** Compact "May 14, 9:30 AM PT" — short month/day with time, no year. */
export function formatPTShort(iso: Input): string {
  const d = toDate(iso);
  if (!d) return '—';
  const formatted = new Intl.DateTimeFormat('en-US', {
    timeZone: PT_ZONE,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(d);
  return `${formatted} PT`;
}
