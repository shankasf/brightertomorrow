'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  type CalEvent,
  type Therapist,
  BUSINESS_END_HOUR,
  BUSINESS_START_HOUR,
  GRID_END_HOUR,
  GRID_START_HOUR,
  GRID_TOTAL_PX,
  HOUR_HEIGHT_PX,
  dayKey,
  eventClipping,
  fmtHourLabel,
  fmtTimePT,
  fmtWeekdayShortPT,
  gridHeightPx,
  gridTopPx,
  ptDayKey,
  ptMinutesFromMidnight,
  todayPT,
  weekDaysFrom,
} from '@/app/admin/calendar/types';

type Props = {
  weekStart: { y: number; m: number; d: number };
  loading: boolean;
  events: CalEvent[];
  therapistsById: Map<number, Therapist>;
  selectedKey: string | null;
  onSelectDay: (key: string, date: Date) => void;
};

// ─────────────────────────────────────────────────────────────────────────────
// Overlap packing — given a column's events, partition them into "lanes" so
// concurrent events sit side-by-side instead of stacked. Returns a render plan
// keyed by event id: { lane, lanes } → translates to width/left in pixels.
// Greedy first-fit on PT start time, O(n²) worst case but n is tiny here.
// ─────────────────────────────────────────────────────────────────────────────

type LaneInfo = { lane: number; lanes: number };

function packLanes(events: CalEvent[]): Map<string, LaneInfo> {
  const sorted = [...events].sort((a, b) => {
    const av = ptMinutesFromMidnight(a.startISO) ?? 0;
    const bv = ptMinutesFromMidnight(b.startISO) ?? 0;
    return av - bv;
  });

  type Cluster = { endsAt: number; lanes: number[] /* end-minute per lane */; ids: string[] };
  const clusters: Cluster[] = [];

  const placement = new Map<string, { lane: number; clusterIdx: number }>();

  for (const e of sorted) {
    const s = ptMinutesFromMidnight(e.startISO) ?? 0;
    const en = Math.max(ptMinutesFromMidnight(e.endISO) ?? s + 60, s + 15);

    // Find a cluster whose latest end is still >= s — events touching the
    // cluster join it. Otherwise start a new cluster.
    let cluster = clusters.find((c) => c.endsAt > s);
    if (!cluster) {
      cluster = { endsAt: en, lanes: [], ids: [] };
      clusters.push(cluster);
    }
    // Pick the first lane whose previous event ended at-or-before s.
    let lane = cluster.lanes.findIndex((laneEnd) => laneEnd <= s);
    if (lane === -1) {
      lane = cluster.lanes.length;
      cluster.lanes.push(en);
    } else {
      cluster.lanes[lane] = en;
    }
    cluster.endsAt = Math.max(cluster.endsAt, en);
    cluster.ids.push(e.id);
    placement.set(e.id, { lane, clusterIdx: clusters.indexOf(cluster) });
  }

  const out = new Map<string, LaneInfo>();
  for (const e of sorted) {
    const p = placement.get(e.id);
    if (!p) continue;
    out.set(e.id, { lane: p.lane, lanes: clusters[p.clusterIdx].lanes.length });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────

export default function CalendarWeek({
  weekStart, loading, events, therapistsById, selectedKey, onSelectDay,
}: Props) {
  const days = useMemo(
    () => weekDaysFrom(weekStart.y, weekStart.m, weekStart.d),
    [weekStart.y, weekStart.m, weekStart.d],
  );

  const eventsByDay = useMemo(() => {
    const m = new Map<string, CalEvent[]>();
    for (const e of events) {
      const k = ptDayKey(e.startISO);
      if (!k) continue;
      const arr = m.get(k);
      if (arr) arr.push(e);
      else m.set(k, [e]);
    }
    return m;
  }, [events]);

  const today = todayPT();
  const todayKey = dayKey(today.y, today.m, today.d);

  // Auto-scroll the grid to ~current time when "today" is in the visible week.
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!scrollRef.current) return;
    const inWeek = days.some((d) => d.y === today.y && d.m === today.m && d.d === today.d);
    if (!inWeek) {
      scrollRef.current.scrollTop = 2 * HOUR_HEIGHT_PX; // 8 AM
      return;
    }
    const now = nowInPTMinutes();
    const top = Math.max(0, ((now / 60) - GRID_START_HOUR) * HOUR_HEIGHT_PX - 120);
    scrollRef.current.scrollTop = top;
  }, [days, today.y, today.m, today.d]);

  // Per-day event totals — surfaced in the header so staff can scan workload
  // without counting bars.
  const countsByDay = useMemo(() => {
    const m = new Map<string, number>();
    for (const [k, arr] of eventsByDay) m.set(k, arr.length);
    return m;
  }, [eventsByDay]);

  return (
    <div className="overflow-hidden rounded-2xl border border-[#E5E5E5] bg-white shadow-[0_1px_2px_rgba(25,39,53,0.04)]">
      {/* Header row — day labels with workload count */}
      <div className="grid border-b border-[#EDE6D9]" style={gridTemplate()}>
        <div className="border-r border-[#EDE6D9] bg-cream-alt/40" />
        {days.map((d) => {
          const k = dayKey(d.y, d.m, d.d);
          const isToday = k === todayKey;
          const isSelected = k === selectedKey;
          const weekday = fmtWeekdayShortPT(d.date);
          const count = countsByDay.get(k) ?? 0;
          return (
            <button
              key={k}
              type="button"
              onClick={() => onSelectDay(k, d.date)}
              aria-pressed={isSelected}
              className={`flex flex-col items-center gap-1 border-r border-[#EDE6D9] py-3 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-500 ${
                isSelected ? 'bg-violet-50' : isToday ? 'bg-amber-50/40 hover:bg-amber-50/70' : 'hover:bg-cream/60'
              }`}
            >
              <span className={`text-[10.5px] font-semibold uppercase tracking-[0.14em] ${
                isToday ? 'text-violet-700' : 'text-ink-soft'
              }`}>
                {weekday}
              </span>
              <span
                className={`grid h-8 w-8 place-items-center rounded-full text-[15px] tabular-nums ${
                  isToday
                    ? 'bg-violet-600 font-semibold text-white shadow-sm'
                    : isSelected
                    ? 'font-semibold text-violet-700'
                    : 'font-semibold text-ink'
                }`}
              >
                {d.d}
              </span>
              {count > 0 ? (
                <span className="text-[10px] font-medium tabular-nums text-ink-soft">
                  {count} {count === 1 ? 'event' : 'events'}
                </span>
              ) : (
                <span className="text-[10px] font-medium tabular-nums text-ink-faint">
                  —
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div ref={scrollRef} className="relative max-h-[720px] overflow-y-auto">
        <div className="relative grid" style={{ ...gridTemplate(), minHeight: GRID_TOTAL_PX }}>
          {/* Hour gutter */}
          <div className="sticky left-0 z-10 border-r border-[#EDE6D9] bg-white">
            {Array.from({ length: GRID_END_HOUR - GRID_START_HOUR }).map((_, i) => {
              const h = GRID_START_HOUR + i;
              return (
                <div
                  key={h}
                  className="-mt-2 flex items-start justify-end pr-2 pt-0 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-faint"
                  style={{ height: HOUR_HEIGHT_PX }}
                >
                  <span className="bg-white px-1">{fmtHourLabel(h)}</span>
                </div>
              );
            })}
          </div>

          {/* Day columns */}
          {days.map((d, dayIdx) => {
            const k = dayKey(d.y, d.m, d.d);
            const dayEvents = eventsByDay.get(k) ?? [];
            const isToday = k === todayKey;
            const isSelected = k === selectedKey;
            return (
              <DayColumn
                key={k}
                dayKeyStr={k}
                isToday={isToday}
                isSelected={isSelected}
                last={dayIdx === days.length - 1}
                events={dayEvents}
                loading={loading}
                therapistsById={therapistsById}
                onSelectDay={() => onSelectDay(k, d.date)}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

function gridTemplate(): React.CSSProperties {
  return { gridTemplateColumns: '64px repeat(7, minmax(0, 1fr))' };
}

function DayColumn({
  dayKeyStr, isToday, isSelected, last, events, loading, therapistsById, onSelectDay,
}: {
  dayKeyStr: string;
  isToday: boolean;
  isSelected: boolean;
  last: boolean;
  events: CalEvent[];
  loading: boolean;
  therapistsById: Map<number, Therapist>;
  onSelectDay: () => void;
}) {
  const lanes = useMemo(() => packLanes(events), [events]);

  const businessTop = (BUSINESS_START_HOUR - GRID_START_HOUR) * HOUR_HEIGHT_PX;
  const businessHeight = (BUSINESS_END_HOUR - BUSINESS_START_HOUR) * HOUR_HEIGHT_PX;

  return (
    <button
      type="button"
      onClick={onSelectDay}
      aria-label={`Open day ${dayKeyStr} side panel — ${events.length} ${events.length === 1 ? 'event' : 'events'}`}
      className={`relative h-full text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-500 ${
        last ? '' : 'border-r border-[#EDE6D9]'
      } ${isSelected ? 'bg-violet-50/30' : isToday ? 'bg-amber-50/30' : 'bg-white hover:bg-cream/40'}`}
      style={{ minHeight: GRID_TOTAL_PX }}
    >
      {/* Business-hours band — subtle tint behind 8 AM–6 PM */}
      <div
        className="pointer-events-none absolute left-0 right-0 bg-cream-alt/30"
        style={{ top: businessTop, height: businessHeight }}
        aria-hidden
      />

      {/* Hour grid lines + half-hour subdividers */}
      {Array.from({ length: GRID_END_HOUR - GRID_START_HOUR }).map((_, i) => (
        <div
          key={i}
          className="pointer-events-none absolute left-0 right-0"
          style={{ top: i * HOUR_HEIGHT_PX, height: HOUR_HEIGHT_PX }}
          aria-hidden
        >
          {i !== 0 && <div className="absolute inset-x-0 top-0 h-px bg-[#EAE2D2]" />}
          {/* Dashed half-hour line */}
          <div
            className="absolute inset-x-0 border-t border-dashed border-[#F1ECE2]"
            style={{ top: HOUR_HEIGHT_PX / 2 }}
          />
        </div>
      ))}

      {/* Current-time line — only on today */}
      {isToday && <NowLine />}

      {loading ? (
        <div className="absolute inset-x-1 top-3 space-y-2">
          <div className="h-10 animate-pulse rounded-md bg-cream-alt/60" />
          <div className="h-14 animate-pulse rounded-md bg-cream-alt/60" />
        </div>
      ) : (
        <AnimatePresence initial={false}>
          {events.map((e) => {
            const lane = lanes.get(e.id) ?? { lane: 0, lanes: 1 };
            return (
              <EventBlock
                key={e.id}
                event={e}
                therapist={therapistsById.get(e.staffId)}
                lane={lane}
                compact
              />
            );
          })}
        </AnimatePresence>
      )}
    </button>
  );
}

// Live-updating "now" indicator. Re-renders once a minute via setInterval.
function NowLine() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);
  // tick is referenced to silence the unused-var lint while forcing re-render.
  void tick;

  const now = nowInPTMinutes();
  const offsetMin = now - GRID_START_HOUR * 60;
  if (offsetMin < 0 || offsetMin >= (GRID_END_HOUR - GRID_START_HOUR) * 60) return null;
  const top = (offsetMin / 60) * HOUR_HEIGHT_PX;

  return (
    <div className="pointer-events-none absolute left-0 right-0 z-20" style={{ top }} aria-hidden>
      <div className="relative h-px bg-rose-500/80">
        <span className="absolute -left-[3px] -top-[3px] block h-[7px] w-[7px] rounded-full bg-rose-500 ring-2 ring-white" />
      </div>
    </div>
  );
}

function nowInPTMinutes(): number {
  const m = ptMinutesFromMidnight(new Date().toISOString());
  return m ?? 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// EventBlock — used by both Week and Day views (re-imported there). Renders
// at absolute position inside its column wrapper.
// ─────────────────────────────────────────────────────────────────────────────

export function EventBlock({
  event, therapist, lane, compact,
}: {
  event: CalEvent;
  therapist: Therapist | undefined;
  lane: LaneInfo;
  compact: boolean;
}) {
  const top = gridTopPx(event.startISO);
  if (top === null) return null;
  const height = gridHeightPx(event.startISO, event.endISO);
  const color = therapist?.colorHex ?? '#6B7280';
  const therapistName = therapist?.name ?? `Staff #${event.staffId}`;
  const firstName = therapistName.split(' ')[0] || 'Unknown';
  const startStr = fmtTimePT(event.startISO);
  const endStr = fmtTimePT(event.endISO);
  const isOutlined = event.status === 'tentative' || event.status === 'pending';
  const isCancelled = event.status === 'cancelled';
  const isHold = event.type === 'hold';
  const isShift = event.type === 'shift';

  const widthPct = 100 / lane.lanes;
  const leftPct = lane.lane * widthPct;

  // Inset right so adjacent lanes don't touch the next column's border.
  const inset = lane.lanes > 1 ? 2 : 1;
  const { before, after } = eventClipping(event.startISO, event.endISO);

  // ─── Visual treatment ──────────────────────────────────────────────
  // Solid (confirmed appointments) → colored left stripe + tinted white
  //   body. Readable type, high contrast, color stays as identity hint.
  // Outlined (tentative / pending) → dashed border, light tint, color text.
  // Hold → diagonal stripes, dashed border.
  // Shift → soft tinted body with thicker stripe + "Shift" pill so it
  //   reads as ambient/background rather than a client appointment.
  //
  // This is a much bigger change than just sizing: instead of fully
  // saturated event bodies (which crushed the white text), confirmed
  // appointments now read as cards with a colored stripe — like Cal.com
  // and Linear. Time + therapist sit at 12.5/13px which is the smallest
  // legible size for tabular text at this density.

  let bodyStyle: React.CSSProperties;
  let textColor = '#1F2937'; // ink
  let stripeStyle: React.CSSProperties | null = null;

  if (isHold) {
    bodyStyle = {
      background: `repeating-linear-gradient(45deg, ${color}26 0px, ${color}26 5px, ${color}0d 5px, ${color}0d 10px)`,
      border: `1px dashed ${color}99`,
    };
    textColor = color;
  } else if (isOutlined) {
    bodyStyle = {
      background: `linear-gradient(180deg, ${color}12 0%, ${color}08 100%)`,
      border: `1px dashed ${color}99`,
    };
    textColor = color;
  } else if (isShift) {
    bodyStyle = {
      background: `linear-gradient(180deg, ${color}18 0%, ${color}0a 100%)`,
      border: `1px solid ${color}40`,
    };
    textColor = color;
    stripeStyle = { background: color, width: 3, opacity: 0.85 };
  } else {
    // Confirmed appointment — card style with colored stripe + tinted body
    bodyStyle = {
      background: `linear-gradient(180deg, ${color}1f 0%, ${color}10 100%)`,
      border: `1px solid ${color}55`,
    };
    textColor = '#1F2937';
    stripeStyle = { background: color, width: 3 };
  }

  // For very short events (< 36px) we collapse to a single-line variant.
  const isShort = height < 36;
  const isMedium = height >= 36 && height < 64;

  return (
    <motion.div
      role="article"
      title={`${therapistName} · ${event.summary} · ${startStr} – ${endStr} PT`}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
      className={`absolute z-10 overflow-hidden rounded-md shadow-[0_1px_2px_rgba(25,39,53,0.06)] backdrop-blur-[1px] ${
        isCancelled ? 'opacity-60' : ''
      }`}
      style={{
        top,
        height,
        left: `calc(${leftPct}% + ${inset}px)`,
        width: `calc(${widthPct}% - ${inset * 2}px)`,
        color: textColor,
        ...bodyStyle,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Colored left stripe — identity at-a-glance */}
      {stripeStyle && (
        <span
          className="absolute inset-y-0 left-0 rounded-l-md"
          style={stripeStyle}
          aria-hidden
        />
      )}

      <div
        className={`relative flex h-full flex-col ${
          stripeStyle ? 'pl-2 pr-1.5' : 'px-1.5'
        } py-1 leading-tight ${isCancelled ? 'line-through' : ''}`}
      >
        {isShort ? (
          // Single-line — time + first name, tight.
          <div className="flex items-center gap-1 truncate">
            <span className="font-semibold tabular-nums" style={{ fontSize: 11 }}>
              {startStr.replace(' ', '')}
            </span>
            <span className="truncate font-medium" style={{ fontSize: 11 }}>
              {firstName}
            </span>
            {isHold && <span className="ml-auto text-[9px] font-semibold uppercase tracking-wider opacity-80">Hold</span>}
          </div>
        ) : (
          <>
            <div className="flex items-center gap-1.5">
              <span className="truncate font-semibold tabular-nums" style={{ fontSize: 12.5 }}>
                {startStr}
                <span className="text-ink-faint" style={{ color: textColor === '#1F2937' ? undefined : `${color}99` }}>
                  {' – '}
                </span>
                {endStr}
              </span>
              {before && (
                <span className="rounded bg-white/70 px-1 text-[9px] font-semibold tabular-nums" style={{ color }}>
                  ↑
                </span>
              )}
            </div>
            <div className="mt-0.5 flex items-center gap-1.5">
              <span
                className="inline-block h-2 w-2 shrink-0 rounded-full"
                style={{ background: color }}
                aria-hidden
              />
              <span className="truncate font-medium" style={{ fontSize: 12 }}>
                {firstName}
              </span>
              {isHold && (
                <span
                  className="ml-auto shrink-0 rounded-sm px-1 text-[9.5px] font-semibold uppercase tracking-wider"
                  style={{ background: `${color}22`, color }}
                >
                  Hold
                </span>
              )}
              {isShift && (
                <span
                  className="ml-auto shrink-0 rounded-sm px-1 text-[9.5px] font-semibold uppercase tracking-wider"
                  style={{ background: `${color}22`, color }}
                >
                  Shift
                </span>
              )}
            </div>
            {!isMedium && event.summary && !isHold && (
              <div
                className={`mt-0.5 truncate ${isOutlined ? 'opacity-85' : 'opacity-75'}`}
                style={{ fontSize: 11.5 }}
              >
                {event.summary}
              </div>
            )}
            {/* For compact (week) view, surface "tentative" inline at bottom */}
            {!compact && isOutlined && !isHold && !isShift && height >= 84 && (
              <div className="mt-auto pt-0.5">
                <span
                  className="inline-block rounded-sm px-1 text-[9.5px] font-semibold uppercase tracking-wider"
                  style={{ background: `${color}22`, color }}
                >
                  Tentative
                </span>
              </div>
            )}
          </>
        )}
        {after && (
          <span
            className="absolute bottom-0.5 right-1 rounded bg-white/70 px-1 text-[9px] font-semibold tabular-nums"
            style={{ color }}
          >
            ↓
          </span>
        )}
      </div>
    </motion.div>
  );
}
