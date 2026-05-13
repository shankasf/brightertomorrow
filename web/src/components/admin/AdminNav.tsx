'use client';
import type { ReactElement } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion } from 'framer-motion';
import { AdminUser } from './useAdminAuth';

type Icon = (props: { className?: string }) => ReactElement;

const I = {
  dashboard: ({ className = '' }) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" />
    </svg>
  ),
  mail: ({ className = '' }) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" />
    </svg>
  ),
  chat: ({ className = '' }) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12a8 8 0 0 1-11.4 7.2L3 21l1.8-6.6A8 8 0 1 1 21 12z" />
    </svg>
  ),
  newsletter: ({ className = '' }) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 4h12a2 2 0 0 1 2 2v14H4z" /><path d="M18 8h2a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2" /><path d="M8 8h6M8 12h6M8 16h4" />
    </svg>
  ),
  shield: ({ className = '' }) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3 4 6v6c0 5 3.5 8.5 8 9 4.5-.5 8-4 8-9V6z" /><path d="m9 12 2 2 4-4" />
    </svg>
  ),
  user: ({ className = '' }) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" />
    </svg>
  ),
  trash: ({ className = '' }) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14" />
    </svg>
  ),
  settings: ({ className = '' }) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09c0 .67.4 1.27 1 1.51a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.24.6.84 1 1.51 1H21a2 2 0 1 1 0 4h-.09c-.67 0-1.27.4-1.51 1z" />
    </svg>
  ),
  question: ({ className = '' }) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><path d="M9.1 9a3 3 0 1 1 5.8 1c-.5 1.6-2.9 1.7-2.9 4M12 17h.01" />
    </svg>
  ),
  pencil: ({ className = '' }) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4z" />
    </svg>
  ),
  users: ({ className = '' }) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="8.5" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  stethoscope: ({ className = '' }) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4.8 2.3A.3.3 0 1 0 5 2H4a2 2 0 0 0-2 2v5a6 6 0 0 0 6 6 6 6 0 0 0 6-6V4a2 2 0 0 0-2-2h-1a.2.2 0 1 0 .2.3" />
      <path d="M8 15v1a6 6 0 0 0 6 6 6 6 0 0 0 6-6v-4" /><circle cx="20" cy="10" r="2" />
    </svg>
  ),
  star: ({ className = '' }) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 15.1 8.5 22 9.3 17 14.1 18.2 21 12 17.8 5.8 21 7 14.1 2 9.3 8.9 8.5 12 2" />
    </svg>
  ),
  pin: ({ className = '' }) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 1 1 18 0z" /><circle cx="12" cy="10" r="3" />
    </svg>
  ),
  calendar: ({ className = '' }) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="17" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  ),
  link: ({ className = '' }) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 1 0-7.07-7.07L11 5" />
      <path d="M14 11a5 5 0 0 0-7.07 0l-3 3A5 5 0 1 0 11 21l1.5-1.5" />
    </svg>
  ),
  chart: ({ className = '' }) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3v18h18" /><path d="M7 14l3-3 4 4 6-6" />
    </svg>
  ),
  logout: ({ className = '' }) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5M21 12H9" />
    </svg>
  ),
};

type NavLink = { href: string; label: string; icon: Icon; superadminOnly?: boolean };
type NavGroup = { group: string; superadminOnly?: boolean };
type NavEntry = NavLink | NavGroup;

const nav: NavEntry[] = [
  { href: '/admin', label: 'Dashboard', icon: I.dashboard },
  { href: '/admin/appointments', label: 'Appointment Requests', icon: I.calendar },
  { href: '/admin/calendar', label: 'Calendar', icon: I.calendar },
  { href: '/admin/insurance-checks', label: 'Insurance Checks', icon: I.shield },
  { href: '/admin/callbacks', label: 'Callback Req. — Chatbot', icon: I.chat },
  { href: '/admin/contacts', label: 'Enquiries — Website', icon: I.mail },
  { href: '/admin/chat', label: 'Chat Sessions', icon: I.chat },
  { href: '/admin/newsletter', label: 'Newsletter', icon: I.newsletter },
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

export default function AdminNav({ user, onLogout }: { user: AdminUser; onLogout: () => void }) {
  const pathname = usePathname();
  const isSuperadmin = user.role === 'superadmin';
  const initial = (user.email[0] ?? 'A').toUpperCase();

  return (
    <aside className="relative flex w-64 shrink-0 flex-col overflow-hidden border-r border-black/30 bg-gradient-to-b from-[#192735] via-[#1d2c3d] to-[#253A4D] text-cream/90">
      {/* Warm accent glows */}
      <div className="pointer-events-none absolute -left-12 top-0 h-48 w-48 rounded-full bg-brand/20 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-20 -right-10 h-48 w-48 rounded-full bg-[#66202A]/25 blur-3xl" />

      {/* Brand */}
      <div className="relative px-5 pb-4 pt-5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand to-[#cf9e57] text-[13px] font-bold text-ink shadow-[0_6px_20px_rgba(225,184,120,0.45)]">
            BT
          </div>
          <div className="leading-tight">
            <div className="serif text-[14px] font-bold tracking-tight text-white">Brighter Tomorrow</div>
            <div className="text-[10.5px] font-medium uppercase tracking-[0.18em] text-brand/85">Admin Console</div>
          </div>
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
              <span className="relative z-10 truncate">{item.label}</span>
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
