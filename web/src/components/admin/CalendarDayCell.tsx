'use client';
import { useEffect, useState } from 'react';
import { fmtTimePT } from '@/app/admin/calendar/types';
import type { CalEvent, Therapist } from '@/app/admin/calendar/types';

type Props = {
  date: Date;            // a 12:00 UTC anchor for the PT day represented by this cell
  dayNumber: number;     // 1..31 — PT day-of-month
  inMonth: boolean;
  isToday: boolean;
  isSelected: boolean;
  events: CalEvent[];
  therapistsById: Map<number, Therapist>;
  onSelect: () => void;
};

// Show up to 4 bars; if there are more, render a "+N more" pill. Bars used to
// be fully-saturated which crushed the small text; the new design is a tinted
// card with a colored left stripe (matches the week view treatment) so dense
// months still read as a coherent visual system.
const MAX_BARS = 4;

export default function CalendarDayCell({
  date,
  dayNumber,
  inMonth,
  isToday,
  isSelected,
  events,
  therapistsById,
  onSelect,
}: Props) {
  const visible = events.slice(0, MAX_BARS);
  const overflow = events.length - visible.length;
  const isoDay = date.toISOString().slice(0, 10);

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={`${isoDay} — ${events.length} event${events.length === 1 ? '' : 's'}${isToday ? ', today' : ''}`}
      aria-pressed={isSelected}
      className={`group relative flex h-full min-h-[116px] w-full flex-col items-stretch rounded-lg border bg-white p-1.5 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${
        isSelected
          ? 'border-violet-400 ring-1 ring-violet-300 shadow-[0_4px_16px_-8px_rgba(124,58,237,0.45)]'
          : isToday
          ? 'border-amber-200 bg-amber-50/40 hover:border-amber-300'
          : 'border-[#EDE6D9] hover:border-[#D9D9D9] hover:bg-cream/40'
      } ${inMonth ? '' : 'bg-cream-alt/30'}`}
    >
      <div className="flex items-center justify-between">
        <span
          className={`grid h-7 w-7 place-items-center rounded-full text-[13px] tabular-nums transition-colors ${
            isToday
              ? 'bg-violet-600 font-semibold text-white shadow-sm'
              : isSelected
              ? 'font-semibold text-violet-700'
              : inMonth
              ? 'font-semibold text-ink'
              : 'text-ink-faint'
          }`}
        >
          {dayNumber}
        </span>
        {events.length > 0 && (
          <span
            className={`grid h-5 min-w-[20px] place-items-center rounded-full px-1 text-[10px] font-semibold tabular-nums ${
              isToday
                ? 'bg-violet-100 text-violet-700'
                : 'bg-cream-alt text-ink-soft'
            }`}
          >
            {events.length}
          </span>
        )}
      </div>

      <div className="mt-1.5 flex flex-1 flex-col gap-[3px] overflow-hidden">
        {visible.map((e) => {
          const t = therapistsById.get(e.staffId);
          const color = t?.colorHex ?? '#6B7280';
          const firstName = (t?.name ?? '').split(' ')[0] || 'Unknown';
          if (e.type === 'hold') {
            return <HoldBlock key={e.id} ev={e} color={color} firstName={firstName} />;
          }
          return (
            <EventBar
              key={e.id}
              ev={e}
              color={color}
              therapistName={t?.name ?? ''}
              firstName={firstName}
            />
          );
        })}
        {overflow > 0 && (
          <span className="mt-auto pl-1 text-[10.5px] font-semibold text-ink-soft">
            +{overflow} more
          </span>
        )}
      </div>
    </button>
  );
}

function EventBar({
  ev,
  color,
  therapistName,
  firstName,
}: {
  ev: CalEvent;
  color: string;
  therapistName: string;
  firstName: string;
}) {
  // Confirmed → tinted card with colored stripe.
  // Tentative/pending → dashed border + lighter tint.
  // Cancelled → strikethrough + low opacity.
  // Shift → no client name implied; rendered with "Shift" suffix.
  const isOutlined = ev.status === 'tentative' || ev.status === 'pending';
  const isCancelled = ev.status === 'cancelled';
  const isShift = ev.type === 'shift';
  const time = fmtTimePT(ev.startISO).replace(' ', '').toLowerCase();

  return (
    <span
      title={`${therapistName} · ${ev.summary} · ${fmtTimePT(ev.startISO)}`}
      className={`relative flex items-center overflow-hidden rounded-[5px] pl-[8px] pr-1.5 py-[3px] text-[11px] leading-tight ${
        isCancelled ? 'opacity-55 line-through' : ''
      }`}
      style={
        isOutlined
          ? {
              color,
              border: `1px dashed ${color}80`,
              background: `${color}0d`,
            }
          : {
              color: '#1F2937',
              background: `linear-gradient(180deg, ${color}1f 0%, ${color}10 100%)`,
              border: `1px solid ${color}40`,
            }
      }
    >
      {/* Colored stripe on the left edge */}
      <span
        className="absolute inset-y-0 left-0 w-[3px]"
        style={{ background: color, opacity: isOutlined ? 0.7 : 1 }}
        aria-hidden
      />
      <span className="truncate font-semibold">{firstName}</span>
      {isShift && (
        <span
          className="ml-1 shrink-0 rounded-sm px-1 text-[9px] font-semibold uppercase tracking-wider"
          style={{ background: `${color}22`, color }}
        >
          Shift
        </span>
      )}
      <span
        className="ml-auto shrink-0 pl-1 tabular-nums opacity-75"
        style={{ fontSize: 10 }}
      >
        {time}
      </span>
    </span>
  );
}

function HoldBlock({ ev, color, firstName }: { ev: CalEvent; color: string; firstName: string }) {
  const [remaining, setRemaining] = useState<number | null>(() => msUntil(ev.expiresAtISO));
  useEffect(() => {
    if (!ev.expiresAtISO) return;
    const id = setInterval(() => setRemaining(msUntil(ev.expiresAtISO)), 1000);
    return () => clearInterval(id);
  }, [ev.expiresAtISO]);

  const expired = remaining !== null && remaining <= 0;

  return (
    <span
      title={`Soft hold · ${ev.summary}`}
      className="relative flex items-center overflow-hidden rounded-[5px] pl-[8px] pr-1.5 py-[3px] text-[11px] leading-tight transition-opacity"
      style={{
        color,
        background: `repeating-linear-gradient(45deg, ${color}24 0px, ${color}24 5px, ${color}0a 5px, ${color}0a 10px)`,
        border: `1px dashed ${color}80`,
        opacity: expired ? 0 : 0.92,
      }}
    >
      <span
        className="absolute inset-y-0 left-0 w-[3px]"
        style={{ background: color, opacity: 0.7 }}
        aria-hidden
      />
      <span className="truncate font-semibold">{firstName}</span>
      <span
        className="ml-1 shrink-0 rounded-sm px-1 text-[9px] font-semibold uppercase tracking-wider"
        style={{ background: `${color}22`, color }}
      >
        Hold
      </span>
      {remaining !== null && !expired && (
        <span className="ml-auto shrink-0 rounded bg-amber-100 px-1 text-[9px] font-semibold tabular-nums text-amber-800">
          {fmtRemaining(remaining)}
        </span>
      )}
    </span>
  );
}

function msUntil(iso?: string): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return t - Date.now();
}

function fmtRemaining(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
