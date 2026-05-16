'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
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
  fmtHourLabel,
  fmtTimePT,
  gridHeightPx,
  gridTopPx,
  ptDayKey,
  ptMinutesFromMidnight,
  statusLabel,
  statusTone,
  todayPT,
} from '@/app/admin/calendar/types';
import { Pill } from './ui';
import { EventBlock } from './CalendarWeek';

type LaneInfo = { lane: number; lanes: number };

// Same packing algorithm as CalendarWeek, kept local so the day view can be
// imported standalone without pulling private helpers across modules.
function packLanes(events: CalEvent[]): Map<string, LaneInfo> {
  const sorted = [...events].sort((a, b) => {
    const av = ptMinutesFromMidnight(a.startISO) ?? 0;
    const bv = ptMinutesFromMidnight(b.startISO) ?? 0;
    return av - bv;
  });
  type Cluster = { endsAt: number; lanes: number[]; ids: string[] };
  const clusters: Cluster[] = [];
  const placement = new Map<string, { lane: number; clusterIdx: number }>();
  for (const e of sorted) {
    const s = ptMinutesFromMidnight(e.startISO) ?? 0;
    const en = Math.max(ptMinutesFromMidnight(e.endISO) ?? s + 60, s + 15);
    let cluster = clusters.find((c) => c.endsAt > s);
    if (!cluster) {
      cluster = { endsAt: en, lanes: [], ids: [] };
      clusters.push(cluster);
    }
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

type Props = {
  day: { y: number; m: number; d: number };
  loading: boolean;
  events: CalEvent[];
  therapistsById: Map<number, Therapist>;
};

export default function CalendarDay({ day, loading, events, therapistsById }: Props) {
  const todayKey = useMemo(() => {
    const t = todayPT();
    return dayKey(t.y, t.m, t.d);
  }, []);
  const currentKey = dayKey(day.y, day.m, day.d);
  const isToday = currentKey === todayKey;

  const dayEvents = useMemo(() => {
    return events
      .filter((e) => ptDayKey(e.startISO) === currentKey)
      .sort((a, b) => Date.parse(a.startISO) - Date.parse(b.startISO));
  }, [events, currentKey]);

  const lanes = useMemo(() => packLanes(dayEvents), [dayEvents]);

  // Top-line counts for the summary strip.
  const counts = useMemo(() => {
    let confirmed = 0, tentative = 0, cancelled = 0, holds = 0;
    for (const e of dayEvents) {
      if (e.type === 'hold') { holds += 1; continue; }
      if (e.status === 'confirmed') confirmed += 1;
      else if (e.status === 'cancelled') cancelled += 1;
      else tentative += 1;
    }
    return { confirmed, tentative, cancelled, holds, total: dayEvents.length };
  }, [dayEvents]);

  const earliest = dayEvents[0];
  const latest = dayEvents[dayEvents.length - 1];

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!scrollRef.current) return;
    if (isToday) {
      const now = ptMinutesFromMidnight(new Date().toISOString()) ?? 0;
      const top = Math.max(0, ((now / 60) - GRID_START_HOUR) * HOUR_HEIGHT_PX - 120);
      scrollRef.current.scrollTop = top;
    } else if (earliest) {
      const t = gridTopPx(earliest.startISO);
      if (t !== null) scrollRef.current.scrollTop = Math.max(0, t - 80);
    } else {
      scrollRef.current.scrollTop = 2 * HOUR_HEIGHT_PX;
    }
  }, [currentKey, isToday, earliest]);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="overflow-hidden rounded-2xl border border-[#E5E5E5] bg-white shadow-[0_1px_2px_rgba(25,39,53,0.04)]">
        {/* Top strip — counts */}
        <div className="flex flex-wrap items-center gap-2 border-b border-[#EDE6D9] bg-cream-alt/30 px-4 py-2.5">
          <CountPill label="Total" value={counts.total} tone="slate" />
          <CountPill label="Confirmed" value={counts.confirmed} tone="green" />
          <CountPill label="Tentative" value={counts.tentative} tone="amber" />
          {counts.cancelled > 0 && <CountPill label="Cancelled" value={counts.cancelled} tone="red" />}
          {counts.holds > 0 && <CountPill label="Holds" value={counts.holds} tone="violet" />}
          {earliest && latest && (
            <span className="ml-auto text-[11px] text-ink-soft">
              <span className="font-medium text-ink">{fmtTimePT(earliest.startISO)}</span>
              {' – '}
              <span className="font-medium text-ink">{fmtTimePT(latest.endISO)}</span>
              {' PT'}
            </span>
          )}
        </div>

        <div ref={scrollRef} className="relative max-h-[720px] overflow-y-auto">
          <div className="relative grid" style={{ gridTemplateColumns: '64px minmax(0, 1fr)', minHeight: GRID_TOTAL_PX }}>
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

            {/* Single day column */}
            <div
              className={`relative ${isToday ? 'bg-amber-50/20' : 'bg-white'}`}
              style={{ minHeight: GRID_TOTAL_PX }}
            >
              {/* Business-hours band */}
              <div
                className="pointer-events-none absolute left-0 right-0 bg-cream-alt/30"
                style={{
                  top: (BUSINESS_START_HOUR - GRID_START_HOUR) * HOUR_HEIGHT_PX,
                  height: (BUSINESS_END_HOUR - BUSINESS_START_HOUR) * HOUR_HEIGHT_PX,
                }}
                aria-hidden
              />
              {Array.from({ length: GRID_END_HOUR - GRID_START_HOUR }).map((_, i) => (
                <div
                  key={i}
                  className="pointer-events-none absolute left-0 right-0"
                  style={{ top: i * HOUR_HEIGHT_PX, height: HOUR_HEIGHT_PX }}
                  aria-hidden
                >
                  {i !== 0 && <div className="absolute inset-x-0 top-0 h-px bg-[#EAE2D2]" />}
                  <div
                    className="absolute inset-x-0 border-t border-dashed border-[#F1ECE2]"
                    style={{ top: HOUR_HEIGHT_PX / 2 }}
                  />
                </div>
              ))}

              {isToday && <NowLine />}

              {loading ? (
                <div className="absolute inset-x-3 top-4 space-y-2">
                  <div className="h-12 animate-pulse rounded-md bg-cream-alt/60" />
                  <div className="h-20 animate-pulse rounded-md bg-cream-alt/60" />
                  <div className="h-14 animate-pulse rounded-md bg-cream-alt/60" />
                </div>
              ) : dayEvents.length === 0 ? (
                <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 px-6 text-center text-sm text-ink-soft">
                  Nothing on the books for this day.
                </div>
              ) : (
                <AnimatePresence initial={false}>
                  {dayEvents.map((e) => {
                    const lane = lanes.get(e.id) ?? { lane: 0, lanes: 1 };
                    return (
                      <EventBlock
                        key={e.id}
                        event={e}
                        therapist={therapistsById.get(e.staffId)}
                        lane={lane}
                        compact={false}
                      />
                    );
                  })}
                </AnimatePresence>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Right rail — agenda list, sorted */}
      <aside className="rounded-2xl border border-[#E5E5E5] bg-white shadow-[0_1px_2px_rgba(25,39,53,0.04)]">
        <div className="border-b border-[#EDE6D9] px-4 py-3">
          <h3 className="text-[13px] font-semibold tracking-tight text-ink">Today’s agenda</h3>
          <p className="mt-0.5 text-[11px] text-ink-soft">
            {dayEvents.length} {dayEvents.length === 1 ? 'event' : 'events'} · sorted by start
          </p>
        </div>
        <div className="max-h-[592px] overflow-y-auto px-3 py-3">
          {dayEvents.length === 0 ? (
            <p className="px-2 py-6 text-center text-[12px] text-ink-soft">No events to show.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {dayEvents.map((e) => {
                const t = therapistsById.get(e.staffId);
                const color = t?.colorHex ?? '#6B7280';
                return (
                  <li
                    key={e.id}
                    className="flex items-start gap-2 rounded-lg border border-[#EDE6D9] bg-white px-2.5 py-2 transition-colors hover:border-[#D9D9D9]"
                  >
                    <span
                      className="mt-1 inline-block h-2 w-2 shrink-0 rounded-full"
                      style={{ background: color }}
                      aria-hidden
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                        <span className="text-[12px] font-semibold tabular-nums text-ink">
                          {fmtTimePT(e.startISO)}
                        </span>
                        <span className="text-[11px] text-ink-soft tabular-nums">
                          – {fmtTimePT(e.endISO)}
                        </span>
                        {e.type === 'hold' ? (
                          <Pill tone="amber">Hold</Pill>
                        ) : e.type === 'shift' ? (
                          <Pill tone="slate">Shift</Pill>
                        ) : (
                          <Pill tone={statusTone(e.status)} dot>{statusLabel(e.status)}</Pill>
                        )}
                      </div>
                      <div className="mt-0.5 truncate text-[12px] text-ink/80">
                        {t?.name ?? `Staff #${e.staffId}`}
                      </div>
                      {e.summary && e.type !== 'hold' && (
                        <div className="truncate text-[11px] text-ink-soft">{e.summary}</div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </aside>
    </div>
  );
}

function CountPill({
  label, value, tone,
}: {
  label: string;
  value: number;
  tone: 'slate' | 'green' | 'amber' | 'red' | 'violet';
}) {
  const cls: Record<'slate' | 'green' | 'amber' | 'red' | 'violet', string> = {
    slate:  'bg-cream-alt text-ink',
    green:  'bg-emerald-50 text-emerald-800 ring-1 ring-inset ring-emerald-200/60',
    amber:  'bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200/60',
    red:    'bg-rose-50 text-rose-800 ring-1 ring-inset ring-rose-200/60',
    violet: 'bg-violet-50 text-violet-800 ring-1 ring-inset ring-violet-200/60',
  };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${cls[tone]}`}>
      <span className="uppercase tracking-[0.08em] opacity-70">{label}</span>
      <span className="tabular-nums">{value}</span>
    </span>
  );
}

function NowLine() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);
  const now = ptMinutesFromMidnight(new Date().toISOString()) ?? 0;
  const offsetMin = now - GRID_START_HOUR * 60;
  if (offsetMin < 0 || offsetMin >= (GRID_END_HOUR - GRID_START_HOUR) * 60) return null;
  const top = (offsetMin / 60) * HOUR_HEIGHT_PX;
  return (
    <div className="pointer-events-none absolute left-0 right-0 z-20" style={{ top }} aria-hidden>
      <div className="relative h-px bg-rose-500/80">
        <span className="absolute left-0 -top-[3px] block h-[7px] w-[7px] rounded-full bg-rose-500 ring-2 ring-white" />
        <span className="absolute -right-1 -top-[7px] rounded-sm bg-rose-500 px-1 text-[9px] font-semibold tracking-[0.04em] text-white">
          NOW
        </span>
      </div>
    </div>
  );
}
