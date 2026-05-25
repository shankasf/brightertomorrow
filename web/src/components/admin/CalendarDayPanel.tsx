'use client';
import { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  type CalEvent,
  type Therapist,
  fmtDayLabelPT,
} from '@/app/admin/calendar/types';
import CalendarEventRow from './CalendarEventRow';
import { LuX, LuCalendar } from 'react-icons/lu';

type Props = {
  open: boolean;
  selectedDate: Date | null;
  events: CalEvent[];
  therapistsById: Map<number, Therapist>;
  onClose: () => void;
};

// Slide-in side panel listing the selected day's events. Pulls double-duty
// as the keyboard-accessible drawer (Esc closes, focus is trapped via
// aria-modal + role="dialog").
export default function CalendarDayPanel({ open, selectedDate, events, therapistsById, onClose }: Props) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && selectedDate && (
        <motion.aside
          key="day-panel"
          role="dialog"
          aria-modal="false"
          aria-label="Day appointments"
          initial={{ x: 16, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 16, opacity: 0 }}
          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          className="flex max-h-[70vh] w-full shrink-0 flex-col overflow-hidden rounded-2xl border border-[#E5E5E5] bg-white shadow-[0_8px_28px_-16px_rgba(25,39,53,0.18)] lg:h-full lg:max-h-none lg:w-[380px]"
        >
          <header className="flex items-center justify-between border-b border-[#EDE6D9] px-4 py-3">
            <div>
              <h3 className="text-[15px] font-semibold tracking-tight text-ink">
                {fmtDayLabelPT(selectedDate)}
              </h3>
              <p className="mt-0.5 text-[11px] font-medium uppercase tracking-[0.14em] text-ink-soft">
                {events.length === 0
                  ? 'Empty day'
                  : `${events.length} event${events.length === 1 ? '' : 's'} · PT`}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close day panel"
              className="grid h-8 w-8 place-items-center rounded-lg text-ink-soft transition-colors hover:bg-cream hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
            >
              <LuX width={16} height={16} strokeWidth={2} />
            </button>
          </header>

          <div className="flex-1 overflow-y-auto px-3 py-3">
            {events.length === 0 ? (
              <div className="mt-10 text-center text-sm text-ink-soft">
                <div className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-full bg-cream-alt/60 text-ink-soft">
                  <LuCalendar width={18} height={18} strokeWidth={1.7} aria-hidden />
                </div>
                No appointments — nice and clear.
              </div>
            ) : (
              <ul className="flex flex-col gap-2">
                {events.map((ev) => (
                  <CalendarEventRow key={ev.id} ev={ev} therapist={therapistsById.get(ev.staffId)} />
                ))}
              </ul>
            )}
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
