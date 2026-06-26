'use client';
import { LuBell } from 'react-icons/lu';

/**
 * Bell button that opens the notification drawer. Shows a "99+"-capped count
 * badge when there are unread items. `tone` adapts the colours to the dark
 * sidebar ("dark") vs the light mobile topbar ("light").
 */
export default function NotificationBell({
  total,
  onClick,
  tone = 'dark',
}: {
  total: number;
  onClick: () => void;
  tone?: 'dark' | 'light';
}) {
  const base =
    tone === 'dark'
      ? 'text-cream/70 ring-white/15 hover:bg-white/10 hover:text-white'
      : 'bg-white text-ink ring-[#EDE6D9] shadow-sm hover:bg-cream-alt';
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={total > 0 ? `Notifications, ${total} new` : 'Notifications'}
      className={`relative inline-flex h-9 w-9 items-center justify-center rounded-xl ring-1 ring-inset transition active:scale-[0.96] ${base}`}
    >
      <LuBell className="h-[18px] w-[18px]" strokeWidth={1.8} />
      {total > 0 && (
        <span
          className="absolute -right-1 -top-1 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#66202A] px-1 text-[10px] font-bold leading-none text-white ring-2 ring-[#1d2c3d] shadow-[0_2px_8px_rgba(102,32,42,0.5)]"
          aria-hidden
        >
          {total > 99 ? '99+' : total}
        </span>
      )}
    </button>
  );
}
