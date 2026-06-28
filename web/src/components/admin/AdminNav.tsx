'use client';
import type { ReactElement } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion } from 'framer-motion';
import {
  LuLayoutDashboard,
  LuMail,
  LuMessageCircle,
  LuNewspaper,
  LuShieldCheck,
  LuUser,
  LuTrash2,
  LuSettings,
  LuCircleHelp,
  LuPencil,
  LuUsers,
  LuStethoscope,
  LuStar,
  LuMapPin,
  LuCalendar,
  LuLink,
  LuChartLine,
  LuTarget,
  LuLogOut,
  LuX,
} from 'react-icons/lu';
import { AdminUser } from './useAdminAuth';
import NotificationBell from './NotificationBell';

type Icon = (props: { className?: string }) => ReactElement;

const I = {
  dashboard: ({ className = '' }) => <LuLayoutDashboard className={className} strokeWidth={1.7} />,
  mail: ({ className = '' }) => <LuMail className={className} strokeWidth={1.7} />,
  chat: ({ className = '' }) => <LuMessageCircle className={className} strokeWidth={1.7} />,
  newsletter: ({ className = '' }) => <LuNewspaper className={className} strokeWidth={1.7} />,
  shield: ({ className = '' }) => <LuShieldCheck className={className} strokeWidth={1.7} />,
  user: ({ className = '' }) => <LuUser className={className} strokeWidth={1.7} />,
  trash: ({ className = '' }) => <LuTrash2 className={className} strokeWidth={1.7} />,
  settings: ({ className = '' }) => <LuSettings className={className} strokeWidth={1.7} />,
  question: ({ className = '' }) => <LuCircleHelp className={className} strokeWidth={1.7} />,
  pencil: ({ className = '' }) => <LuPencil className={className} strokeWidth={1.7} />,
  users: ({ className = '' }) => <LuUsers className={className} strokeWidth={1.7} />,
  stethoscope: ({ className = '' }) => <LuStethoscope className={className} strokeWidth={1.7} />,
  star: ({ className = '' }) => <LuStar className={className} strokeWidth={1.7} />,
  pin: ({ className = '' }) => <LuMapPin className={className} strokeWidth={1.7} />,
  calendar: ({ className = '' }) => <LuCalendar className={className} strokeWidth={1.7} />,
  link: ({ className = '' }) => <LuLink className={className} strokeWidth={1.7} />,
  chart: ({ className = '' }) => <LuChartLine className={className} strokeWidth={1.7} />,
  accuracy: ({ className = '' }) => <LuTarget className={className} strokeWidth={1.7} />,
  logout: ({ className = '' }) => <LuLogOut className={className} strokeWidth={1.7} />,
};

// `section` ties a nav item to a notification-badge key returned by
// GET /admin/api/notifications/counts. Items without one never show a badge.
type NavLink = { href: string; label: string; icon: Icon; superadminOnly?: boolean; section?: string };
type NavGroup = { group: string; superadminOnly?: boolean };
type NavEntry = NavLink | NavGroup;

const nav: NavEntry[] = [
  { href: '/admin', label: 'Dashboard', icon: I.dashboard },
  { href: '/admin/appointments', label: 'Appointment Requests', icon: I.calendar, section: 'appointments' },
  { href: '/admin/calendar', label: 'Calendar', icon: I.calendar },
  { href: '/admin/matching', label: 'Therapist Matching', icon: I.users, section: 'matching' },
  { href: '/admin/insurance-checks', label: 'Insurance Checks', icon: I.shield, section: 'insurance_checks' },
  { href: '/admin/callbacks', label: 'Callback Req. — Chatbot', icon: I.chat, section: 'callbacks' },
  { href: '/admin/contacts', label: 'Enquiries — Website', icon: I.mail, section: 'contacts' },
  { href: '/admin/chat', label: 'Chat Sessions', icon: I.chat, section: 'chat' },
  { href: '/admin/newsletter', label: 'Newsletter', icon: I.newsletter, section: 'newsletter' },
  { group: 'Agent Accuracy', superadminOnly: true },
  { href: '/admin/agent-accuracy', label: 'Accuracy Overview', icon: I.accuracy, superadminOnly: true },
  { group: 'HIPAA Compliance', superadminOnly: true },
  { href: '/admin/logs', label: 'Live AI Logs', icon: I.chart, superadminOnly: true },
  { href: '/admin/audit/phi', label: 'PHI Audit Log', icon: I.shield, superadminOnly: true },
  { href: '/admin/audit/access', label: 'Activity Log', icon: I.user, superadminOnly: true },
  { href: '/admin/audit/purge', label: 'Purge Queue', icon: I.trash, superadminOnly: true },
  { group: 'Content', superadminOnly: true },
  { href: '/admin/content/settings', label: 'Site Settings', icon: I.settings, superadminOnly: true },
  { href: '/admin/content/faqs', label: 'FAQs', icon: I.question, superadminOnly: true },
  { href: '/admin/content/blog', label: 'Blog Posts', icon: I.pencil, superadminOnly: true },
  { href: '/admin/content/team', label: 'Team', icon: I.users, superadminOnly: true },
  { href: '/admin/content/services', label: 'Services', icon: I.stethoscope, superadminOnly: true },
  { href: '/admin/content/testimonials', label: 'Testimonials', icon: I.star, superadminOnly: true },
  { href: '/admin/content/locations', label: 'Locations', icon: I.pin, superadminOnly: true },
  { href: '/admin/content/nav', label: 'Navigation', icon: I.link, superadminOnly: true },
  { href: '/admin/content/stats', label: 'Stats', icon: I.chart, superadminOnly: true },
];

export default function AdminNav({
  user,
  onLogout,
  onClose,
  counts,
  notifTotal,
  onOpenNotifications,
}: {
  user: AdminUser;
  onLogout: () => void;
  onClose?: () => void;
  counts: Record<string, number>;
  notifTotal: number;
  onOpenNotifications: () => void;
}) {
  const pathname = usePathname();
  const isSuperadmin = user.role === 'superadmin';
  const initial = (user.email[0] ?? 'A').toUpperCase();

  return (
    <aside className="relative flex h-full w-64 shrink-0 flex-col overflow-hidden border-r border-black/30 bg-gradient-to-b from-[#192735] via-[#1d2c3d] to-[#253A4D] text-cream/90">
      {/* Warm accent glows */}
      <div className="pointer-events-none absolute -left-12 top-0 h-48 w-48 rounded-full bg-brand/20 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-20 -right-10 h-48 w-48 rounded-full bg-[#66202A]/25 blur-3xl" />

      {/* Brand */}
      <div className="relative flex items-start justify-between px-5 pb-4 pt-5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand to-[#cf9e57] text-[13px] font-bold text-ink shadow-[0_6px_20px_rgba(225,184,120,0.45)]">
            BT
          </div>
          <div className="leading-tight">
            <div className="serif text-[14px] font-bold tracking-tight text-white">Brighter Tomorrow</div>
            <div className="text-[10.5px] font-medium uppercase tracking-[0.18em] text-brand/85">Admin Console</div>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <NotificationBell total={notifTotal} onClick={onOpenNotifications} tone="dark" />
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close navigation"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-cream/70 ring-1 ring-inset ring-white/15 transition hover:bg-white/10 hover:text-white lg:hidden"
            >
              <LuX width={16} height={16} strokeWidth={2} />
            </button>
          )}
        </div>
      </div>

      {/* User */}
      <div className="relative mx-3 mb-3 flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 backdrop-blur">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand to-[#66202A] text-xs font-semibold text-white">
          {initial}
        </div>
        <div className="min-w-0 leading-tight">
          <div className="truncate text-[12.5px] font-medium text-white">{user.email}</div>
          <div className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-cream/80">
            <span className={`h-1.5 w-1.5 rounded-full ${isSuperadmin ? 'bg-brand shadow-[0_0_8px_rgba(225,184,120,0.85)]' : 'bg-cream/40'}`} />
            {user.role}
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="relative flex-1 overflow-y-auto px-2 pb-4">
        {nav.map((item, i) => {
          if ('group' in item) {
            if (item.superadminOnly && !isSuperadmin) return null;
            return (
              <div
                key={i}
                className="mb-1 mt-5 px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-brand/70"
              >
                {item.group}
              </div>
            );
          }
          if (item.superadminOnly && !isSuperadmin) return null;
          const active = pathname === item.href || (item.href !== '/admin' && pathname.startsWith(item.href));
          const Icon = item.icon;
          const badge = item.section ? counts[item.section] ?? 0 : 0;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`group relative my-0.5 flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors ${
                active
                  ? 'text-white'
                  : 'text-cream/70 hover:bg-white/[0.04] hover:text-white'
              }`}
            >
              {active && (
                <motion.span
                  layoutId="adminNavActive"
                  className="absolute inset-0 -z-0 rounded-lg bg-gradient-to-r from-brand/20 via-brand/10 to-transparent ring-1 ring-inset ring-brand/30"
                  transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                />
              )}
              {active && (
                <motion.span
                  layoutId="adminNavBar"
                  className="absolute -left-1 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-gradient-to-b from-brand to-[#cf9e57] shadow-[0_0_10px_rgba(225,184,120,0.8)]"
                  transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                />
              )}
              <Icon className={`relative z-10 h-[18px] w-[18px] shrink-0 transition-transform ${active ? 'text-brand' : 'text-cream/50 group-hover:text-cream'}`} />
              <span className="relative z-10 min-w-0 flex-1 truncate">{item.label}</span>
              {badge > 0 && (
                <span
                  className="relative z-10 ml-auto inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-[#66202A] px-1.5 text-[10px] font-bold leading-none text-white ring-1 ring-inset ring-white/20 shadow-[0_2px_8px_rgba(102,32,42,0.5)]"
                  aria-label={`${badge} new`}
                >
                  {badge > 99 ? '99+' : badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="relative border-t border-white/10 p-3">
        <button
          onClick={onLogout}
          className="group flex w-full items-center gap-2 rounded-lg px-3 py-2 text-[12.5px] font-medium text-cream/70 transition-colors hover:bg-[#66202A]/40 hover:text-white"
        >
          <I.logout className="h-[16px] w-[16px] text-cream/50 group-hover:text-brand" />
          Sign out
        </button>
        <div className="mt-2 px-3 text-[10px] leading-relaxed text-cream/40">
          HIPAA §164.312 protected
        </div>
      </div>
    </aside>
  );
}
