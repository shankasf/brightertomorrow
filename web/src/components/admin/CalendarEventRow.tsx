'use client';
import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { adminFetch } from './useAdminAuth';
import { Pill } from './ui';
import {
  type CalEvent,
  type Therapist,
  fmtTimePT,
  statusLabel,
  statusTone,
} from '@/app/admin/calendar/types';

type Props = {
  ev: CalEvent;
  therapist: Therapist | undefined;
};

// Single appointment row in the side panel. The description is PHI and is
// only fetched when the user clicks "View details" — every call hits the
// audited /admin/api/calendar/events/{id}/details endpoint.
export default function CalendarEventRow({ ev, therapist }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [description, setDescription] = useState<string | null>(null);

  const color = therapist?.colorHex ?? '#6B7280';
  const therapistName = therapist?.name ?? `Staff #${ev.staffId}`;
  const time = `${fmtTimePT(ev.startISO)} – ${fmtTimePT(ev.endISO)} PT`;

  async function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (description !== null || !ev.hasDetails) return;
    setLoading(true);
    setError('');
    try {
      const r = await adminFetch(`/admin/api/calendar/events/${encodeURIComponent(ev.id)}/details`);
      if (!r.ok) throw new Error(`${r.status}`);
      const body = (await r.json()) as { description?: string };
      setDescription(body.description ?? '');
    } catch {
      setError('Could not load details.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <li className="rounded-xl border border-[#EDE6D9] bg-white p-3 transition-colors hover:border-[#D9D9D9]">
      <div className="flex items-start gap-2.5">
        <span
          className="mt-1 inline-block h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ background: color }}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="text-[13px] font-semibold text-ink tabular-nums">{time}</span>
            <Pill tone={statusTone(ev.status)} dot>{statusLabel(ev.status)}</Pill>
            {ev.type === 'hold' && <Pill tone="amber">Soft hold</Pill>}
            {ev.type === 'shift' && <Pill tone="slate">Shift</Pill>}
          </div>
          <div className="mt-0.5 text-[12.5px] text-ink/80">{therapistName}</div>
          {ev.summary && ev.type !== 'hold' && (
            <div className="mt-0.5 truncate text-[12px] text-ink-soft">{ev.summary}</div>
          )}

          {ev.hasDetails && ev.type === 'appointment' && (
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                onClick={toggle}
                aria-expanded={open}
                className="inline-flex items-center gap-1.5 rounded-md border border-[#E5E5E5] bg-white px-2 py-1 text-[11.5px] font-medium text-ink/80 transition-colors hover:bg-cream focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <rect x="3" y="11" width="18" height="11" rx="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                {open ? 'Hide details' : 'View details'}
              </button>
              <span className="text-[10.5px] text-ink-soft" title="Every view of patient details is recorded in the PHI access log.">
                Viewing this is audited.
              </span>
            </div>
          )}

          <AnimatePresence initial={false}>
            {open && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                className="overflow-hidden"
              >
                <div className="mt-2 rounded-md bg-cream-alt/60 px-2.5 py-2 text-[12px] leading-relaxed text-ink/80">
                  {loading && <span className="text-ink-soft">Loading details…</span>}
                  {error && <span className="text-rose-700">{error}</span>}
                  {!loading && !error && description !== null && (
                    description.trim().length === 0 ? (
                      <span className="text-ink-soft">No additional notes.</span>
                    ) : (
                      <pre className="whitespace-pre-wrap font-sans">{description}</pre>
                    )
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </li>
  );
}
