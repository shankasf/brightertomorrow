'use client';
import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { Therapist } from '@/app/admin/calendar/types';
import { LuChevronDown } from 'react-icons/lu';

type Props = {
  therapists: Therapist[];
  selected: Set<number>;
  onToggle: (staffId: number) => void;
};

// Therapist legend — collapsed by default into a single trigger button so it
// doesn't eat vertical real estate above the grid. Click reveals a popover
// with one chip per therapist; connected feeds use filled dots, "not
// connected" therapists are shown in a separate group with dashed outlines.
export default function CalendarLegend({ therapists, selected, onToggle }: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close on outside click + Esc.
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('mousedown', onDoc);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDoc);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const connected = therapists.filter((t) => t.feedConnected);
  const notConnected = therapists.filter((t) => !t.feedConnected);
  const activeConnected = connected.filter((t) => selected.has(t.staffId)).length;
  const allOn = activeConnected === connected.length;
  const noneOn = activeConnected === 0;

  // Build a small color preview — first 5 connected colors stack into a
  // dotted strip so the trigger gives a visual hint of the team without
  // expanding the popover.
  const preview = connected.slice(0, 5);

  return (
    <div ref={wrapRef} className="relative mb-3 flex items-center justify-end">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`Therapist filters — ${activeConnected} of ${connected.length} active`}
        className="inline-flex h-8 items-center gap-2 rounded-full border border-[#E5E5E5] bg-white px-3 text-[12px] font-medium text-ink/80 shadow-sm transition-colors hover:bg-cream focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
      >
        <span className="flex -space-x-1.5" aria-hidden>
          {preview.map((t) => (
            <span
              key={t.staffId}
              className="inline-block h-3 w-3 rounded-full ring-2 ring-white transition-opacity"
              style={{
                background: t.colorHex,
                opacity: selected.has(t.staffId) ? 1 : 0.3,
              }}
            />
          ))}
        </span>
        <span>
          {allOn ? 'All therapists' : noneOn ? 'No therapists' : `${activeConnected} of ${connected.length}`}
        </span>
        <LuChevronDown
          width={12} height={12} strokeWidth={2}
          className={`text-ink-faint transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden
        />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="dialog"
            aria-label="Therapist filters"
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }}
            className="absolute right-0 top-full z-30 mt-2 w-[min(360px,calc(100vw-1.5rem))] origin-top-right rounded-2xl border border-[#E5E5E5] bg-white p-3 shadow-[0_18px_40px_-18px_rgba(25,39,53,0.28)]"
          >
            <div className="mb-1.5 flex items-center justify-between px-1">
              <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink-soft">
                Therapists
              </span>
              <span className="text-[10.5px] tabular-nums text-ink-faint">
                {activeConnected}/{connected.length} visible
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {connected.map((t) => (
                <Chip key={t.staffId} t={t} active={selected.has(t.staffId)} onClick={() => onToggle(t.staffId)} />
              ))}
            </div>
            {notConnected.length > 0 && (
              <>
                <div className="my-3 h-px bg-[#EDE6D9]" />
                <div className="mb-1.5 px-1 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink-soft">
                  Calendar not connected
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {notConnected.map((t) => (
                    <ChipFaded
                      key={t.staffId}
                      t={t}
                      active={selected.has(t.staffId)}
                      onClick={() => onToggle(t.staffId)}
                    />
                  ))}
                </div>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
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
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={`${t.name} — calendar feed not yet generated`}
      title="Calendar feed not yet generated."
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
  );
}
