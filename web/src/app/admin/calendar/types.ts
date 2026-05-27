// Shared types + roster constants for the admin calendar. The gateway returns
// the same roster + colors; we mirror them here so the UI never breaks when
// the backend is still being built or briefly unavailable.

export type Therapist = {
  staffId: number;
  name: string;
  feedConnected: boolean;
  colorHex: string;
};

export type EventStatus = 'confirmed' | 'tentative' | 'cancelled' | 'pending';
export type EventType = 'appointment' | 'shift' | 'hold';

export type CalEvent = {
  id: string;
  staffId: number;
  type: EventType;
  startISO: string;
  endISO: string;
  summary: string;
  status: EventStatus;
  hasDetails: boolean;
  /**
   * For type === 'hold' the gateway returns the expiry timestamp so the UI can
   * render a live countdown without polling. Optional because shift/appointment
   * events don't carry one.
   */
  expiresAtISO?: string;
};

// Mirror of the canonical roster — keep in sync with the gateway. The four
// "not connected" therapists are flagged so the legend can render them faded.
export const FALLBACK_ROSTER: Therapist[] = [
  { staffId: 71, name: 'Sagar Shankaran',    feedConnected: true,  colorHex: '#7C3AED' },
  { staffId: 47, name: 'Elisia Danley',      feedConnected: true,  colorHex: '#DB2777' },
  { staffId: 24, name: 'Keunshea Fleming',   feedConnected: true,  colorHex: '#2563EB' },
  { staffId: 21, name: 'Alayna Hammond',     feedConnected: true,  colorHex: '#059669' },
  { staffId: 53, name: 'Janelle Thompson',   feedConnected: true,  colorHex: '#DC2626' },
  { staffId: 59, name: 'Samara Cobb',        feedConnected: false, colorHex: '#6B7280' },
  { staffId: 16, name: 'Joanne Tran',        feedConnected: false, colorHex: '#6B7280' },
  { staffId: 45, name: 'Jordan Fuller',      feedConnected: false, colorHex: '#6B7280' },
  { staffId: 66, name: 'Monica Gonzalez',    feedConnected: false, colorHex: '#6B7280' },
];

export const PT_TZ = 'America/Los_Angeles';

// Format an ISO instant in Pacific Time. Used in legend tooltips, side panel
// rows, etc. All times are explicitly suffixed "PT" in the UI so staff never
// confuse them with browser-local.
export function fmtTimePT(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: PT_TZ,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(t));
}

export function fmtDayLabelPT(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: PT_TZ,
    weekday: 'short',
    month: 'long',
    day: 'numeric',
  }).format(date);
}

export function fmtMonthLabelPT(year: number, month0: number): string {
  // Build a known-good instant inside the month at noon PT — avoids DST edge.
  const probe = new Date(Date.UTC(year, month0, 15, 20, 0, 0));
  return new Intl.DateTimeFormat('en-US', {
    timeZone: PT_TZ,
    month: 'long',
    year: 'numeric',
  }).format(probe);
}

/**
 * Decompose an instant into its PT calendar parts. We never want to rely on
 * the browser's local TZ for grid placement — a staff member in NYC opening
 * this calendar must see the same Pacific day grouping as someone in LA.
 */
export function ptParts(iso: string): { y: number; m: number; d: number } | null {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: PT_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(t));
  const y = Number(parts.find((p) => p.type === 'year')?.value);
  const m = Number(parts.find((p) => p.type === 'month')?.value);
  const d = Number(parts.find((p) => p.type === 'day')?.value);
  if (!y || !m || !d) return null;
  return { y, m: m - 1, d };
}

export function ptDayKey(iso: string): string | null {
  const p = ptParts(iso);
  if (!p) return null;
  return `${p.y}-${String(p.m + 1).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}

export function dayKey(y: number, m0: number, d: number): string {
  return `${y}-${String(m0 + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function todayPT(): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: PT_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  return {
    y: Number(parts.find((p) => p.type === 'year')?.value),
    m: Number(parts.find((p) => p.type === 'month')?.value) - 1,
    d: Number(parts.find((p) => p.type === 'day')?.value),
  };
}

/**
 * Build the [from, to) UTC instants that bound a month in Pacific Time. We
 * pad by one week on each side so the grid's leading/trailing cells (which
 * belong to the prev/next month) still show their events. Returns ISO 8601.
 */
export function monthRangeUTC(year: number, month0: number): { fromISO: string; toISO: string } {
  // PT is UTC-7 (PDT) or UTC-8 (PST). We over-pad by ~10 hours to be safe and
  // by one extra week to cover the grid overflow rows.
  const from = new Date(Date.UTC(year, month0, 1, 0, 0, 0));
  from.setUTCDate(from.getUTCDate() - 8);
  const to = new Date(Date.UTC(year, month0 + 1, 1, 0, 0, 0));
  to.setUTCDate(to.getUTCDate() + 8);
  return { fromISO: from.toISOString(), toISO: to.toISOString() };
}

export function statusTone(s: EventStatus): 'green' | 'amber' | 'red' | 'slate' {
  if (s === 'confirmed') return 'green';
  if (s === 'tentative' || s === 'pending') return 'amber';
  if (s === 'cancelled') return 'red';
  return 'slate';
}

export function statusLabel(s: EventStatus): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// View modes + filters — added for the Day / Week / Month / List switcher.
// ─────────────────────────────────────────────────────────────────────────────

export type ViewMode = 'day' | 'week' | 'month' | 'list';

// Status group used by the chip filters. We collapse tentative + pending into
// a single user-facing group because, in practice, staff treat them the same.
export type StatusGroup = 'all' | 'confirmed' | 'tentative' | 'cancelled';

export type TypeFilter = 'all' | 'appointment' | 'shift' | 'hold';

export function statusGroupOf(s: EventStatus): Exclude<StatusGroup, 'all'> {
  if (s === 'confirmed') return 'confirmed';
  if (s === 'cancelled') return 'cancelled';
  return 'tentative';
}

// Hour grid — therapy-center standard runs roughly 7 AM – 9 PM. We render the
// gutter from 6 AM – 10 PM (16 rows) so early-morning intakes / late evening
// holds aren't clipped. Height per hour bumped to 72px so 30-min appointments
// get ~36px — comfortably tall enough for time + therapist on one row.
export const GRID_START_HOUR = 6;
export const GRID_END_HOUR = 22;          // exclusive (last row label is 9 PM)
export const HOUR_HEIGHT_PX = 72;
export const GRID_TOTAL_HOURS = GRID_END_HOUR - GRID_START_HOUR;
export const GRID_TOTAL_PX = GRID_TOTAL_HOURS * HOUR_HEIGHT_PX;

// Visible clinic / business-hours band — used to subtly tint 8 AM–6 PM on the
// grid so staff can scan high-traffic hours at a glance.
export const BUSINESS_START_HOUR = 8;
export const BUSINESS_END_HOUR = 18;

// Format a 24h integer hour as "6 AM" / "12 PM" / "9 PM" for the gutter.
export function fmtHourLabel(h24: number): string {
  const h12 = ((h24 + 11) % 12) + 1;
  return `${h12} ${h24 < 12 ? 'AM' : 'PM'}`;
}

// PT minutes-since-midnight for an ISO instant. Used to vertically position
// events on the hourly grid. Returns null if the instant fails to parse.
export function ptMinutesFromMidnight(iso: string): number | null {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: PT_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(t));
  const h = Number(parts.find((p) => p.type === 'hour')?.value);
  const m = Number(parts.find((p) => p.type === 'minute')?.value);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  // "24:00" — Intl emits hour=24 at midnight in some locales; clamp.
  return ((h % 24) * 60) + m;
}

// Top offset in px for an event start, relative to the grid's top edge.
// Returns null if the start falls outside the visible hour window — the
// caller renders a small "earlier today" / "later today" pill instead.
export function gridTopPx(iso: string): number | null {
  const min = ptMinutesFromMidnight(iso);
  if (min === null) return null;
  const offsetMin = min - GRID_START_HOUR * 60;
  if (offsetMin < 0 || offsetMin >= GRID_TOTAL_HOURS * 60) return null;
  return (offsetMin / 60) * HOUR_HEIGHT_PX;
}

// Visible height of an event in px, given start + end. Floored to a 22px
// minimum so a 10-minute event still shows its label cleanly.
export function gridHeightPx(startISO: string, endISO: string): number {
  const startMin = ptMinutesFromMidnight(startISO) ?? 0;
  const endMin = ptMinutesFromMidnight(endISO) ?? startMin + 60;
  const visibleMin = Math.max(15, endMin - startMin);
  return Math.max(22, (visibleMin / 60) * HOUR_HEIGHT_PX);
}

// Whether an event starts before / ends after the visible hour window — we
// surface this so a 5 AM hold isn't silently hidden.
export function eventClipping(startISO: string, endISO: string): { before: boolean; after: boolean } {
  const s = ptMinutesFromMidnight(startISO);
  const e = ptMinutesFromMidnight(endISO);
  return {
    before: s !== null && s < GRID_START_HOUR * 60,
    after: e !== null && e > GRID_END_HOUR * 60,
  };
}

// Sunday-anchored start of a PT week given any PT calendar (y, m0, d).
// Returns the same { y, m, d } shape used elsewhere.
export function weekStartPT(y: number, m0: number, d: number): { y: number; m: number; d: number } {
  // Use a noon-UTC anchor inside the day so DST doesn't shift the result.
  const anchor = new Date(Date.UTC(y, m0, d, 20, 0, 0));
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: PT_TZ, weekday: 'short' }).format(anchor);
  const idx = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(weekday);
  const offset = idx < 0 ? 0 : idx;
  const shifted = new Date(anchor);
  shifted.setUTCDate(shifted.getUTCDate() - offset);
  return ptParts(shifted.toISOString()) ?? { y, m: m0, d };
}

// Build an array of 7 PT day descriptors starting from a Sunday anchor.
export function weekDaysFrom(y: number, m0: number, d: number): Array<{ y: number; m: number; d: number; date: Date }> {
  const out: Array<{ y: number; m: number; d: number; date: Date }> = [];
  for (let i = 0; i < 7; i++) {
    const probe = new Date(Date.UTC(y, m0, d + i, 20, 0, 0));
    const p = ptParts(probe.toISOString());
    if (!p) continue;
    out.push({ ...p, date: probe });
  }
  return out;
}

// [from, to) UTC envelope for a PT week, padded to cover DST + leading/trailing.
export function weekRangeUTC(y: number, m0: number, d: number): { fromISO: string; toISO: string } {
  const from = new Date(Date.UTC(y, m0, d, 0, 0, 0));
  from.setUTCDate(from.getUTCDate() - 1);
  const to = new Date(Date.UTC(y, m0, d + 7, 0, 0, 0));
  to.setUTCDate(to.getUTCDate() + 1);
  return { fromISO: from.toISOString(), toISO: to.toISOString() };
}

export function dayRangeUTC(y: number, m0: number, d: number): { fromISO: string; toISO: string } {
  const from = new Date(Date.UTC(y, m0, d, 0, 0, 0));
  from.setUTCDate(from.getUTCDate() - 1);
  const to = new Date(Date.UTC(y, m0, d + 1, 0, 0, 0));
  to.setUTCDate(to.getUTCDate() + 1);
  return { fromISO: from.toISOString(), toISO: to.toISOString() };
}

export function fmtWeekLabelPT(start: { y: number; m: number; d: number }): string {
  const startDate = new Date(Date.UTC(start.y, start.m, start.d, 20, 0, 0));
  const endDate = new Date(Date.UTC(start.y, start.m, start.d + 6, 20, 0, 0));
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: PT_TZ, month: 'short', day: 'numeric',
  });
  const fmtYear = new Intl.DateTimeFormat('en-US', { timeZone: PT_TZ, year: 'numeric' });
  return `${fmt.format(startDate)} – ${fmt.format(endDate)}, ${fmtYear.format(startDate)}`;
}

export function fmtDayLabelLongPT(y: number, m0: number, d: number): string {
  const probe = new Date(Date.UTC(y, m0, d, 20, 0, 0));
  return new Intl.DateTimeFormat('en-US', {
    timeZone: PT_TZ, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  }).format(probe);
}

export function fmtWeekdayShortPT(date: Date): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: PT_TZ, weekday: 'short' }).format(date);
}
