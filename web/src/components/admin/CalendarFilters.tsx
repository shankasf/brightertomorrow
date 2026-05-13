'use client';
import { motion } from 'framer-motion';
import type { StatusGroup, TypeFilter } from '@/app/admin/calendar/types';

type Props = {
  status: StatusGroup;
  onStatusChange: (next: StatusGroup) => void;
  type: TypeFilter;
  onTypeChange: (next: TypeFilter) => void;
  search: string;
  onSearchChange: (next: string) => void;
  // Counts seen *after* therapist + view-range filtering — used as small
  // numeric hints next to each chip so staff know what each filter would
  // actually return without clicking it.
  counts: {
    statusAll: number;
    confirmed: number;
    tentative: number;
    cancelled: number;
    typeAll: number;
    appointment: number;
    shift: number;
    hold: number;
  };
  onClear: () => void;
  canClear: boolean;
};

type ChipGroup<T extends string> = Array<{
  value: T;
  label: string;
  count: number;
  tone: 'neutral' | 'green' | 'amber' | 'red' | 'violet' | 'sky';
}>;

const toneClasses: Record<'neutral' | 'green' | 'amber' | 'red' | 'violet' | 'sky', { active: string; dot: string }> = {
  neutral: { active: 'border-ink/80 bg-ink text-white shadow-sm',            dot: 'bg-ink-soft' },
  green:   { active: 'border-emerald-500 bg-emerald-500 text-white shadow-sm', dot: 'bg-emerald-500' },
  amber:   { active: 'border-amber-500 bg-amber-500 text-white shadow-sm',     dot: 'bg-amber-500' },
  red:     { active: 'border-rose-500 bg-rose-500 text-white shadow-sm',       dot: 'bg-rose-500' },
  violet:  { active: 'border-violet-500 bg-violet-500 text-white shadow-sm',   dot: 'bg-violet-500' },
  sky:     { active: 'border-sky-500 bg-sky-500 text-white shadow-sm',         dot: 'bg-sky-500' },
};

export default function CalendarFilters({
  status, onStatusChange,
  type, onTypeChange,
  search, onSearchChange,
  counts, onClear, canClear,
}: Props) {
  const statusGroup: ChipGroup<StatusGroup> = [
    { value: 'all',        label: 'All statuses',  count: counts.statusAll,  tone: 'neutral' },
    { value: 'confirmed',  label: 'Confirmed',     count: counts.confirmed,  tone: 'green' },
    { value: 'tentative',  label: 'Tentative',     count: counts.tentative,  tone: 'amber' },
    { value: 'cancelled',  label: 'Cancelled',     count: counts.cancelled,  tone: 'red' },
  ];

  const typeGroup: ChipGroup<TypeFilter> = [
    { value: 'all',         label: 'All types',     count: counts.typeAll,      tone: 'neutral' },
    { value: 'appointment', label: 'Appointments',  count: counts.appointment,  tone: 'violet' },
    { value: 'shift',       label: 'Shifts',        count: counts.shift,        tone: 'sky' },
    { value: 'hold',        label: 'Soft holds',    count: counts.hold,         tone: 'amber' },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      className="mb-4 rounded-2xl border border-[#E5E5E5] bg-white px-4 py-3.5 shadow-[0_1px_2px_rgba(25,39,53,0.04)]"
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:gap-5">
        <FilterRow label="Status">
          {statusGroup.map((c) => (
            <Chip
              key={c.value}
              active={status === c.value}
              tone={c.tone}
              count={c.count}
              onClick={() => onStatusChange(c.value)}
              ariaLabel={`Filter by status ${c.label}, ${c.count} ${c.count === 1 ? 'event' : 'events'}`}
            >
              {c.label}
            </Chip>
          ))}
        </FilterRow>

        <FilterRow label="Type">
          {typeGroup.map((c) => (
            <Chip
              key={c.value}
              active={type === c.value}
              tone={c.tone}
              count={c.count}
              onClick={() => onTypeChange(c.value)}
              ariaLabel={`Filter by type ${c.label}, ${c.count} ${c.count === 1 ? 'event' : 'events'}`}
            >
              {c.label}
            </Chip>
          ))}
        </FilterRow>

        <FilterRow label="Search">
          <div className="relative flex-1 lg:min-w-[220px]">
            <svg
              width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint"
              aria-hidden
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input
              type="search"
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search summary…"
              aria-label="Search events by summary"
              className="h-8 w-full rounded-full border border-[#E5E5E5] bg-white pl-7 pr-3 text-[12px] text-ink placeholder:text-ink-faint shadow-sm transition focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-200"
            />
          </div>
          {canClear && (
            <button
              type="button"
              onClick={onClear}
              className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full border border-[#E5E5E5] bg-white px-3 text-[12px] font-medium text-ink/70 transition hover:bg-cream hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
              aria-label="Clear all filters"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
              Clear
            </button>
          )}
        </FilterRow>
      </div>
    </motion.div>
  );
}

function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink-soft">
        {label}
      </span>
      {children}
    </div>
  );
}

function Chip({
  active, tone, count, onClick, ariaLabel, children,
}: {
  active: boolean;
  tone: 'neutral' | 'green' | 'amber' | 'red' | 'violet' | 'sky';
  count: number;
  onClick: () => void;
  ariaLabel: string;
  children: React.ReactNode;
}) {
  const t = toneClasses[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={ariaLabel}
      className={`group inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12px] font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${
        active
          ? t.active
          : 'border-[#E5E5E5] bg-white text-ink/80 hover:border-[#D9D9D9] hover:bg-cream'
      }`}
    >
      {!active && <span className={`h-1.5 w-1.5 rounded-full ${t.dot}`} aria-hidden />}
      <span>{children}</span>
      <span
        className={`grid h-5 min-w-[20px] place-items-center rounded-full px-1 text-[10.5px] font-semibold tabular-nums ${
          active ? 'bg-white/25 text-white' : 'bg-cream-alt text-ink/60'
        }`}
        aria-hidden
      >
        {count}
      </span>
    </button>
  );
}
