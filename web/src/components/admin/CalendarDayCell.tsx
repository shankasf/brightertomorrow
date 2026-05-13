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

const MAX_DOTS = 3;

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
  const visible = events.slice(0, MAX_DOTS);
  const overflow = events.length - visible.length;
  const isoDay = date.toISOString().slice(0, 10);

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={`${isoDay} — ${events.length} event${events.length === 1 ? '' : 's'}${isToday ? ', today' : ''}`}
      aria-pressed={isSelected}
      className={`group relative flex h-full min-h-[92px] w-full flex-col items-stretch rounded-lg border bg-white p-1.5 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${
        isSelected
          ? 'border-violet-400 ring-1 ring-violet-300 shadow-[0_4px_16px_-8px_rgba(124,58,237,0.45)]'
          : 'border-[#EDE6D9] hover:border-[#D9D9D9] hover:bg-cream/40'
      } ${inMonth ? '' : 'bg-cream-alt/30'}`}
    >
      <div className="flex items-center justify-between">
        <span
          className={`grid h-6 w-6 place-items-center rounded-full text-[12px] tabular-nums transition-colors ${
            isToday
              ? 'bg-violet-600 font-semibold text-white'
              : isSelected
              ? 'font-semibold text-violet-700'
              : inMonth
              ? 'font-medium text-ink'
              : 'text-ink-faint'
          }`}
        >
          {dayNumber}
        </span>
        {overflow > 0 && (
          <span className="text-[10px] font-medium tabular-nums text-ink-soft">
            +{overflow}
          </span>
        )}
      </div>

      <div className="mt-1 flex flex-1 flex-col gap-1 overflow-hidden">
        {visible.map((e) => {
          const t = therapistsById.get(e.staffId);
          const color = t?.colorHex ?? '#6B7280';
          const firstName = (t?.name ?? '').split(' ')[0] || 'Unknown';
          if (e.type === 'hold') {
            return <HoldBlock key={e.id} ev={e} color={color} firstName={firstName} />;
          }
          return <EventBar key={e.id} ev={e} color={color} therapistName={t?.name ?? ''} firstName={firstName} />;
        })}
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
  // Confirmed → solid; tentative/pending → outlined; cancelled → strikethrough.
  const isOutlined = ev.status === 'tentative' || ev.status === 'pending';
  const isCancelled = ev.status === 'cancelled';
  const time = fmtTimePT(ev.startISO).replace(' ', '').toLowerCase();
  return (
    <span
      title={`${therapistName} · ${ev.summary} · ${fmtTimePT(ev.startISO)}`}
      className={`flex items-center gap-1 truncate rounded px-1.5 py-[3px] text-[10.5px] leading-tight ${
        isCancelled ? 'opacity-60 line-through' : ''
      }`}
      style={
        isOutlined
          ? { color, border: `1px dashed ${color}66`, background: `${color}0d` }
          : { color: '#fff', background: color }
      }
    >
      <span
        className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ background: isOutlined ? color : 'rgba(255,255,255,0.85)' }}
        aria-hidden
      />
      <span className="truncate font-medium">{firstName}</span>
      <span className="ml-auto shrink-0 tabular-nums opacity-80">{time}</span>
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
      className="relative flex items-center gap-1.5 overflow-hidden rounded px-1.5 py-[3px] text-[10.5px] leading-tight transition-opacity"
      style={{
        color,
        background: `repeating-linear-gradient(45deg, ${color}22 0px, ${color}22 4px, ${color}0a 4px, ${color}0a 8px)`,
        border: `1px dashed ${color}66`,
        opacity: expired ? 0 : 0.85,
      }}
    >
      <span className="truncate font-medium">{firstName} · hold</span>
      {remaining !== null && !expired && (
        <span className="ml-auto shrink-0 rounded bg-amber-100 px-1 text-[9px] font-semibold tabular-nums text-amber-800">
          {fmtRemaining(remaining)} left
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
