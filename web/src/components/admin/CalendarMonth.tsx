'use client';
import { AnimatePresence, motion } from 'framer-motion';
import { useMemo } from 'react';
import {
  type CalEvent,
  type Therapist,
  dayKey,
  ptDayKey,
  todayPT,
} from '@/app/admin/calendar/types';
import CalendarDayCell from './CalendarDayCell';

type Props = {
  year: number;
  month0: number;            // 0..11
  direction: 1 | -1;
  loading: boolean;
  events: CalEvent[];
  therapistsById: Map<number, Therapist>;
  selectedKey: string | null;
  onSelectDay: (key: string, date: Date) => void;
};

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function buildGrid(year: number, month0: number): Array<{
  date: Date; day: number; inMonth: boolean; key: string;
}> {
  // Start on the Sunday on/before the 1st (using a UTC anchor — we only need
  // it for grid placement, not for time math).
  const first = new Date(Date.UTC(year, month0, 1));
  const startOffset = first.getUTCDay(); // 0..6 Sun..Sat in UTC; safe here
  const gridStart = new Date(first);
  gridStart.setUTCDate(first.getUTCDate() - startOffset);
  const cells: Array<{ date: Date; day: number; inMonth: boolean; key: string }> = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart);
    d.setUTCDate(gridStart.getUTCDate() + i);
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth();
    const day = d.getUTCDate();
    cells.push({
      date: d,
      day,
      inMonth: m === month0,
      key: dayKey(y, m, day),
    });
  }
  return cells;
}

export default function CalendarMonth({
  year,
  month0,
  direction,
  loading,
  events,
  therapistsById,
  selectedKey,
  onSelectDay,
}: Props) {
  const grid = useMemo(() => buildGrid(year, month0), [year, month0]);

  // Bucket events into PT day keys once per render.
  const eventsByDay = useMemo(() => {
    const m = new Map<string, CalEvent[]>();
    for (const e of events) {
      const k = ptDayKey(e.startISO);
      if (!k) continue;
      const arr = m.get(k);
      if (arr) arr.push(e);
      else m.set(k, [e]);
    }
    // Sort each day's events by start time so the panel + dots are in order.
    for (const arr of m.values()) {
      arr.sort((a, b) => Date.parse(a.startISO) - Date.parse(b.startISO));
    }
    return m;
  }, [events]);

  const today = todayPT();
  const todayKey = dayKey(today.y, today.m, today.d);

  return (
    <div className="rounded-2xl border border-[#E5E5E5] bg-white p-3 shadow-[0_1px_2px_rgba(25,39,53,0.04)]">
      {/* On phones a 7-col month crushes each cell below legibility, so the
          grid scrolls horizontally inside the card (intentional, scoped to
          <sm); from sm up it's the approved fluid layout. The inner wrapper
          carries a min-width only while scrolling. */}
      <div className="bt-scroll-x -mx-3 px-3 sm:mx-0 sm:overflow-visible sm:px-0">
      <div className="min-w-[560px] sm:min-w-0">
      <div className="grid grid-cols-7 gap-1 pb-2">
        {WEEKDAYS.map((w) => (
          <div
            key={w}
            className="px-2 py-1 text-center text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-soft"
          >
            {w}
          </div>
        ))}
      </div>

      <div className="relative">
        <AnimatePresence mode="wait" initial={false} custom={direction}>
          <motion.div
            key={`${year}-${month0}`}
            custom={direction}
            initial={{ opacity: 0, x: direction * 18 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: direction * -18 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="grid grid-cols-7 grid-rows-6 gap-1"
          >
            {loading
              ? Array.from({ length: 42 }).map((_, i) => (
                  <div
                    key={i}
                    className="min-h-[116px] animate-pulse rounded-lg border border-[#EDE6D9] bg-cream-alt/40"
                  />
                ))
              : grid.map((cell) => {
                  const dayEvents = eventsByDay.get(cell.key) ?? [];
                  return (
                    <CalendarDayCell
                      key={cell.key}
                      date={cell.date}
                      dayNumber={cell.day}
                      inMonth={cell.inMonth}
                      isToday={cell.key === todayKey}
                      isSelected={selectedKey === cell.key}
                      events={dayEvents}
                      therapistsById={therapistsById}
                      onSelect={() => onSelectDay(cell.key, cell.date)}
                    />
                  );
                })}
          </motion.div>
        </AnimatePresence>
      </div>
      </div>
      </div>
    </div>
  );
}
