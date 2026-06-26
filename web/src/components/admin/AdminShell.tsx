'use client';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { useAdminAuth } from './useAdminAuth';
import AdminNav from './AdminNav';
import NotificationPanel from './NotificationPanel';
import NotificationBell from './NotificationBell';
import { useNavCounts } from './useNavCounts';
import { sectionForPath, totalUnread } from './notifSections';
import { BTSpinner } from './Spinner';
import { LuMenu } from 'react-icons/lu';

function ChromedShell({ children }: { children: React.ReactNode }) {
  const { user, loading, logout } = useAdminAuth();
  const pathname = usePathname();
  const [navOpen, setNavOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);

  // Shared notification counts — one poll for the whole shell (badges + drawer).
  const { counts, markSeen } = useNavCounts(!!user);
  const notifTotal = totalUnread(counts);

  // Opening a badged section (click, direct load, or back/forward) clears it.
  useEffect(() => {
    const section = sectionForPath(pathname);
    if (section) markSeen(section);
  }, [pathname, markSeen]);

  // Close the mobile nav drawer + notification drawer on route change.
  useEffect(() => {
    setNavOpen(false);
    setNotifOpen(false);
  }, [pathname]);

  // Lock body scroll while either drawer is open.
  useEffect(() => {
    if (!navOpen && !notifOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [navOpen, notifOpen]);

  if (loading) {
    return (
      <div className="grid h-screen place-items-center bg-gradient-to-br from-[#192735] via-[#1f2c3c] to-[#253A4D]">
        <BTSpinner size="lg" label="Loading admin" />
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="flex h-screen overflow-hidden bg-cream-alt font-sans text-ink antialiased">
      {/* Desktop sidebar */}
      <div className="hidden lg:flex">
        <AdminNav
          user={user}
          onLogout={logout}
          counts={counts}
          notifTotal={notifTotal}
          onOpenNotifications={() => setNotifOpen(true)}
        />
      </div>

      {/* Mobile drawer */}
      <AnimatePresence>
        {navOpen && (
          <>
            <motion.div
              key="scrim"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              onClick={() => setNavOpen(false)}
              className="fixed inset-0 z-40 bg-ink/40 backdrop-blur-sm lg:hidden"
              aria-hidden
            />
            <motion.div
              key="drawer"
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', damping: 26, stiffness: 240 }}
              className="fixed inset-y-0 left-0 z-50 flex lg:hidden"
              role="dialog"
              aria-modal="true"
              aria-label="Admin navigation"
            >
              <AdminNav
                user={user}
                onLogout={logout}
                onClose={() => setNavOpen(false)}
                counts={counts}
                notifTotal={notifTotal}
                onOpenNotifications={() => { setNavOpen(false); setNotifOpen(true); }}
              />
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Notification drawer (right slide-over) — desktop + mobile */}
      <AnimatePresence>
        {notifOpen && (
          <>
            <motion.div
              key="notif-scrim"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              onClick={() => setNotifOpen(false)}
              className="fixed inset-0 z-40 bg-ink/40 backdrop-blur-sm"
              aria-hidden
            />
            <NotificationPanel
              counts={counts}
              markSeen={markSeen}
              onClose={() => setNotifOpen(false)}
            />
          </>
        )}
      </AnimatePresence>

      <main className="relative flex-1 overflow-y-auto">
        {/* Mobile topbar with hamburger */}
        <div className="sticky top-0 z-30 flex items-center gap-3 border-b border-[#EDE6D9] bg-cream-alt/85 px-3 py-2.5 backdrop-blur-md lg:hidden">
          <button
            type="button"
            onClick={() => setNavOpen(true)}
            aria-label="Open navigation"
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-white text-ink shadow-sm ring-1 ring-inset ring-[#EDE6D9] transition active:scale-[0.96]"
          >
            <LuMenu width={18} height={18} strokeWidth={2} />
          </button>
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-brand to-[#cf9e57] text-[11px] font-bold text-ink shadow-[0_4px_12px_rgba(225,184,120,0.4)]">
              BT
            </div>
            <div className="leading-tight">
              <div className="text-[12.5px] font-semibold tracking-tight text-ink">Brighter Tomorrow</div>
              <div className="text-[9.5px] font-medium uppercase tracking-[0.18em] text-ink-soft">Admin Console</div>
            </div>
          </div>
          <div className="ml-auto">
            <NotificationBell total={notifTotal} onClick={() => setNotifOpen(true)} tone="light" />
          </div>
        </div>

        {/* Warm ambient gradient backdrop */}
        <div className="pointer-events-none absolute inset-x-0 top-0 -z-0 h-72 bg-gradient-to-b from-brand-50/70 via-cream-alt/0 to-transparent" />
        <div className="pointer-events-none absolute -right-40 -top-40 -z-0 h-80 w-80 rounded-full bg-brand-100/50 blur-3xl" />
        <div className="pointer-events-none absolute -left-32 top-1/3 -z-0 h-72 w-72 rounded-full bg-[#fbe8eb]/40 blur-3xl" />
        <div className="relative z-10">{children}</div>
      </main>
    </div>
  );
}

export default function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname === '/admin/login') return <>{children}</>;
  return <ChromedShell>{children}</ChromedShell>;
}
