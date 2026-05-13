'use client';
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { Therapist } from '@/app/admin/calendar/types';

type Props = {
  therapists: Therapist[];
  selected: Set<number>;
  onToggle: (staffId: number) => void;
};

// Therapist chip row. Connected feeds use a filled colored dot; "not
// connected" therapists use an open ring (◌) and surface a small tooltip
// explaining why they have no events.
export default function CalendarLegend({ therapists, selected, onToggle }: Props) {
  const connected = therapists.filter((t) => t.feedConnected);
  const notConnected = therapists.filter((t) => !t.feedConnected);

  return (
    <div className="mb-4 rounded-xl border border-[#E5E5E5] bg-white px-4 py-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {connected.map((t) => (
          <Chip key={t.staffId} t={t} active={selected.has(t.staffId)} onClick={() => onToggle(t.staffId)} />
        ))}
      </div>
      {notConnected.length > 0 && (
        <>
          <div className="my-2 h-px bg-[#EDE6D9]" />
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink-soft">
              Calendar not connected
            </span>
            {notConnected.map((t) => (
              <ChipFaded key={t.staffId} t={t} active={selected.has(t.staffId)} onClick={() => onToggle(t.staffId)} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Chip({ t, active, onClick }: { t: Therapist; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={`${active ? 'Hide' : 'Show'} events for ${t.name}`}
      className={`group inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${
        active
          ? 'border-[#E5E5E5] bg-white text-ink shadow-sm hover:bg-cream'
          : 'border-[#EDEDED] bg-cream-alt/60 text-ink-soft hover:text-ink'
      }`}
    >
      <span
        className="inline-block h-2 w-2 rounded-full transition-opacity"
        style={{
          backgroundColor: t.colorHex,
          opacity: active ? 1 : 0.35,
          boxShadow: active ? `0 0 0 2px ${t.colorHex}1f` : undefined,
        }}
        aria-hidden
      />
      <span className={active ? '' : 'line-through decoration-1 decoration-ink-faint'}>{t.name}</span>
    </button>
  );
}

function ChipFaded({ t, active, onClick }: { t: Therapist; active: boolean; onClick: () => void }) {
  const [hover, setHover] = useState(false);
  return (
    <span className="relative">
      <button
        type="button"
        onClick={onClick}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onFocus={() => setHover(true)}
        onBlur={() => setHover(false)}
        aria-pressed={active}
        aria-label={`${t.name} — calendar feed not yet generated`}
        className={`inline-flex items-center gap-1.5 rounded-full border border-dashed px-2.5 py-1 text-[12px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${
          active
            ? 'border-ink-faint/70 bg-cream-alt/60 text-ink/70'
            : 'border-ink-faint/40 bg-transparent text-ink-soft'
        }`}
      >
        <span
          className="inline-block h-2 w-2 rounded-full border border-ink-faint"
          aria-hidden
        />
        {t.name}
      </button>
      <AnimatePresence>
        {hover && (
          <motion.span
            role="tooltip"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.12 }}
            className="absolute left-1/2 top-full z-20 mt-1 w-max max-w-[220px] -translate-x-1/2 rounded-md bg-ink px-2.5 py-1 text-[11px] font-medium text-white shadow-lg"
          >
            Calendar feed not yet generated.
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}
