'use client';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import {
  LuBell,
  LuCheck,
  LuChevronRight,
  LuCalendar,
  LuShieldCheck,
  LuMessageCircle,
  LuMail,
  LuMessagesSquare,
  LuNewspaper,
  LuX,
} from 'react-icons/lu';
import { NOTIF_SECTIONS, totalUnread } from './notifSections';

// Per-section icon for the drawer rows (kept here so notifSections.ts stays a
// pure data module with no React imports).
const SECTION_ICON: Record<string, (p: { className?: string }) => React.ReactElement> = {
  appointments: ({ className }) => <LuCalendar className={className} strokeWidth={1.7} />,
  insurance_checks: ({ className }) => <LuShieldCheck className={className} strokeWidth={1.7} />,
  callbacks: ({ className }) => <LuMessageCircle className={className} strokeWidth={1.7} />,
  contacts: ({ className }) => <LuMail className={className} strokeWidth={1.7} />,
  chat: ({ className }) => <LuMessagesSquare className={className} strokeWidth={1.7} />,
  newsletter: ({ className }) => <LuNewspaper className={className} strokeWidth={1.7} />,
};

/**
 * Right-side notification drawer. Lists every section that has unread items as
 * an aggregate count; clicking a row routes to that section's list page (and
 * marks it seen, clearing the badge).
 *
 * HIPAA: this panel renders only counts + section labels — never a patient
 * name, phone, or message. The actual records live on the destination pages,
 * which audit PHI access on detail views.
 */
export default function NotificationPanel({
  counts,
  markSeen,
  onClose,
}: {
  counts: Record<string, number>;
  markSeen: (section: string) => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const total = totalUnread(counts);
  const active = NOTIF_SECTIONS.filter((s) => (counts[s.section] ?? 0) > 0);

  const openSection = (section: string, href: string) => {
    markSeen(section);
    onClose();
    router.push(href);
  };

  return (
    <motion.aside
      key="notif-drawer"
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'spring', damping: 28, stiffness: 260 }}
      className="fixed inset-y-0 right-0 z-50 flex w-[88%] max-w-sm flex-col border-l border-black/30 bg-gradient-to-b from-[#192735] via-[#1d2c3d] to-[#253A4D] text-cream/90 shadow-2xl"
      role="dialog"
      aria-modal="true"
      aria-label="Notifications"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
        <div className="flex items-center gap-2.5">
          <LuBell className="h-[18px] w-[18px] text-brand" strokeWidth={1.8} />
          <div className="leading-tight">
            <div className="serif text-[15px] font-bold text-white">Notifications</div>
            <div className="text-[11px] font-medium text-cream/60">
              {total > 0 ? `${total} new ${total === 1 ? 'item' : 'items'}` : 'All caught up'}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close notifications"
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-cream/70 ring-1 ring-inset ring-white/15 transition hover:bg-white/10 hover:text-white"
        >
          <LuX className="h-4 w-4" strokeWidth={2} />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-3">
        {active.length === 0 ? (
          <div className="mt-16 flex flex-col items-center px-6 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/5 ring-1 ring-inset ring-white/10">
              <LuCheck className="h-6 w-6 text-brand" strokeWidth={2} />
            </div>
            <div className="mt-3 text-[13px] font-medium text-white">You&apos;re all caught up</div>
            <div className="mt-1 text-[12px] text-cream/55">
              New requests, enquiries, and sessions will show up here.
            </div>
          </div>
        ) : (
          <ul className="space-y-1.5">
            {active.map((s) => {
              const n = counts[s.section] ?? 0;
              const Icon = SECTION_ICON[s.section];
              return (
                <li key={s.section}>
                  <button
                    type="button"
                    onClick={() => openSection(s.section, s.href)}
                    className="group flex w-full items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-3 text-left transition hover:border-brand/40 hover:bg-white/[0.07]"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/[0.06] ring-1 ring-inset ring-white/10">
                      {Icon ? <Icon className="h-[18px] w-[18px] text-brand" /> : null}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-semibold text-white">{s.label}</span>
                      <span className="block truncate text-[11.5px] text-cream/60">
                        {n} {s.blurb}
                      </span>
                    </span>
                    <span className="inline-flex h-[20px] min-w-[20px] shrink-0 items-center justify-center rounded-full bg-[#66202A] px-1.5 text-[10.5px] font-bold leading-none text-white ring-1 ring-inset ring-white/20">
                      {n > 99 ? '99+' : n}
                    </span>
                    <LuChevronRight className="h-4 w-4 shrink-0 text-cream/40 transition group-hover:text-brand" strokeWidth={2} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="border-t border-white/10 px-5 py-3 text-[10px] leading-relaxed text-cream/40">
        Counts only — open a section to view records. HIPAA §164.312(b) audited.
      </div>
    </motion.aside>
  );
}
