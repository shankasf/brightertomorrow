'use client';
import { motion } from 'framer-motion';
import { Button } from './ui';
import type { ViewMode } from '@/app/admin/calendar/types';

type Props = {
  title: string;
  view: ViewMode;
  onViewChange: (next: ViewMode) => void;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  filterSummary: string;
  // Accept any sub-controls (e.g. quick date jumper) — currently unused so the
  // header stays clean; reserved without breaking callers.
};

const VIEW_OPTIONS: Array<{ value: ViewMode; label: string; aria: string }> = [
  { value: 'day',   label: 'Day',   aria: 'Switch to day view' },
  { value: 'week',  label: 'Week',  aria: 'Switch to week view' },
  { value: 'month', label: 'Month', aria: 'Switch to month view' },
];

export default function CalendarHeader({
  title, view, onViewChange, onPrev, onNext, onToday, filterSummary,
}: Props) {
  const prevLabel = view === 'day' ? 'Previous day' : view === 'week' ? 'Previous week' : 'Previous month';
  const nextLabel = view === 'day' ? 'Next day' : view === 'week' ? 'Next week' : 'Next month';

  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#E5E5E5] bg-white px-4 py-3 shadow-[0_1px_2px_rgba(25,39,53,0.04)]">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onPrev}
          aria-label={prevLabel}
          className="grid h-9 w-9 place-items-center rounded-lg border border-[#E5E5E5] bg-white text-ink/70 transition-colors hover:bg-cream hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <h2
          className="min-w-[200px] text-center text-[17px] font-semibold tracking-tight text-ink"
          aria-live="polite"
        >
          {title}
          <span className="ml-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-ink-soft">PT</span>
        </h2>
        <button
          type="button"
          onClick={onNext}
          aria-label={nextLabel}
          className="grid h-9 w-9 place-items-center rounded-lg border border-[#E5E5E5] bg-white text-ink/70 transition-colors hover:bg-cream hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
        <Button variant="secondary" size="sm" onClick={onToday} className="ml-1">
          Today
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <span className="hidden text-xs text-ink-soft md:inline">
          <span className="font-medium text-ink">{filterSummary}</span>
        </span>

        <div
          role="tablist"
          aria-label="Calendar view"
          className="relative inline-flex rounded-lg border border-[#E5E5E5] bg-cream-alt/50 p-0.5 shadow-inner"
        >
          {VIEW_OPTIONS.map((opt) => {
            const active = view === opt.value;
            return (
              <button
                key={opt.value}
                role="tab"
                aria-selected={active}
                aria-label={opt.aria}
                type="button"
                onClick={() => onViewChange(opt.value)}
                className={`relative z-10 inline-flex h-7 items-center justify-center rounded-md px-3 text-[12px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${
                  active ? 'text-ink' : 'text-ink-soft hover:text-ink'
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="cal-view-indicator"
                    className="absolute inset-0 -z-10 rounded-md bg-white shadow-[0_1px_2px_rgba(25,39,53,0.10)] ring-1 ring-inset ring-[#E5E5E5]"
                    transition={{ type: 'spring', stiffness: 480, damping: 36 }}
                  />
                )}
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
