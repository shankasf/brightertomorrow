'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  type CalEvent,
  type Therapist,
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

  return (
    <div className="overflow-hidden rounded-2xl border border-[#E5E5E5] bg-white shadow-[0_1px_2px_rgba(25,39,53,0.04)]">
      {/* Header row — sticky day labels */}
      <div className="grid border-b border-[#EDE6D9]" style={gridTemplate()}>
        <div className="border-r border-[#EDE6D9] bg-cream-alt/40" />
        {days.map((d) => {
          const k = dayKey(d.y, d.m, d.d);
          const isToday = k === todayKey;
          const isSelected = k === selectedKey;
          const weekday = fmtWeekdayShortPT(d.date);
          return (
            <button
              key={k}
              type="button"
              onClick={() => onSelectDay(k, d.date)}
              aria-pressed={isSelected}
              className={`flex flex-col items-center gap-0.5 border-r border-[#EDE6D9] py-2.5 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-500 ${
                isSelected ? 'bg-violet-50' : 'hover:bg-cream/60'
              }`}
            >
              <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink-soft">
                {weekday}
              </span>
              <span
                className={`grid h-7 w-7 place-items-center rounded-full text-[13px] tabular-nums ${
                  isToday
                    ? 'bg-violet-600 font-semibold text-white'
                    : isSelected
                    ? 'font-semibold text-violet-700'
                    : 'font-medium text-ink'
                }`}
              >
                {d.d}
              </span>
            </button>
          );
        })}
      </div>

      <div ref={scrollRef} className="relative max-h-[640px] overflow-y-auto">
        <div className="relative grid" style={{ ...gridTemplate(), minHeight: GRID_TOTAL_PX }}>
          {/* Hour gutter */}
          <div className="relative border-r border-[#EDE6D9] bg-white">
            {Array.from({ length: GRID_END_HOUR - GRID_START_HOUR }).map((_, i) => {
              const h = GRID_START_HOUR + i;
              return (
                <div
                  key={h}
                  className="-mt-2 flex h-[56px] items-start justify-end pr-2 pt-0 text-[10px] font-medium uppercase tracking-[0.08em] text-ink-faint"
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
      {/* Hour grid lines */}
      {Array.from({ length: GRID_END_HOUR - GRID_START_HOUR }).map((_, i) => (
        <div
          key={i}
          className={`absolute left-0 right-0 ${i === 0 ? '' : 'border-t border-[#F1ECE2]'}`}
          style={{ top: i * HOUR_HEIGHT_PX, height: HOUR_HEIGHT_PX }}
          aria-hidden
        />
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
  const time = `${fmtTimePT(event.startISO)} – ${fmtTimePT(event.endISO)}`;
  const isOutlined = event.status === 'tentative' || event.status === 'pending' || event.type === 'hold';
  const isCancelled = event.status === 'cancelled';

  const widthPct = 100 / lane.lanes;
  const leftPct = lane.lane * widthPct;
  const isHold = event.type === 'hold';

  // Inset right so adjacent lanes don't touch the next column's border.
  const inset = lane.lanes > 1 ? 2 : 1;
  const { before, after } = eventClipping(event.startISO, event.endISO);

  return (
    <motion.div
      role="article"
      title={`${therapistName} · ${event.summary} · ${time} PT`}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
      className={`absolute z-10 overflow-hidden rounded-md px-1.5 py-1 text-[11px] leading-tight shadow-[0_1px_2px_rgba(25,39,53,0.08)] ${
        isCancelled ? 'opacity-60 line-through' : ''
      }`}
      style={{
        top,
        height,
        left: `calc(${leftPct}% + ${inset}px)`,
        width: `calc(${widthPct}% - ${inset * 2}px)`,
        color: isOutlined ? color : '#fff',
        background: isHold
          ? `repeating-linear-gradient(45deg, ${color}33 0px, ${color}33 4px, ${color}10 4px, ${color}10 8px)`
          : isOutlined
          ? `${color}14`
          : color,
        border: isOutlined ? `1px dashed ${color}80` : `1px solid ${color}`,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-1">
        {!compact && (
          <span
            className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ background: isOutlined ? color : 'rgba(255,255,255,0.85)' }}
            aria-hidden
          />
        )}
        <span className="truncate font-semibold tabular-nums">{fmtTimePT(event.startISO)}</span>
        {before && <span className="rounded bg-white/30 px-1 text-[9px] font-semibold tabular-nums">↑</span>}
      </div>
      <div className="truncate font-medium">{firstName}</div>
      {height >= 56 && event.summary && (
        <div className={`truncate ${isOutlined ? 'opacity-80' : 'opacity-90'}`}>{event.summary}</div>
      )}
      {after && (
        <span className="absolute bottom-0.5 right-1 rounded bg-white/30 px-1 text-[9px] font-semibold tabular-nums">↓</span>
      )}
    </motion.div>
  );
}
