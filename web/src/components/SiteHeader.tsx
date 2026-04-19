"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  FiMenu, FiX, FiPhone, FiMail, FiChevronDown, FiArrowRight,
  FiFacebook, FiInstagram, FiClock,
} from "react-icons/fi";
import type { NavItem, SiteSettings } from "@/lib/queries";

export default function SiteHeader({ settings, nav }: { settings: SiteSettings; nav: NavItem[] }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const pathname = usePathname();

  useEffect(() => { setMobileOpen(false); }, [pathname]);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header className={`sticky top-0 z-40 transition-shadow ${scrolled ? "shadow-[0_8px_24px_-16px_rgba(0,0,0,0.18)]" : ""}`}>
      {/* Slim utility bar */}
      <div className="hidden md:block bg-[#4a2d1d] text-white/80 text-xs">
        <div className="container-x flex items-center justify-between h-9">
          <div className="flex items-center gap-5">
            {settings.primary_phone && (
              <a href={`tel:${settings.primary_phone}`} className="flex items-center gap-1.5 hover:text-white transition">
                <FiPhone size={12} /> {settings.primary_phone}
              </a>
            )}
            {settings.primary_email && (
              <a href={`mailto:${settings.primary_email}`} className="hidden lg:flex items-center gap-1.5 hover:text-white transition">
                <FiMail size={12} /> {settings.primary_email}
              </a>
            )}
            <span className="hidden xl:flex items-center gap-1.5 text-white/60">
              <FiClock size={12} /> Mon–Fri 9a–8p · Sat–Sun 10a–4p
            </span>
          </div>
          <div className="flex items-center gap-3">
            {settings.social.facebook && (
              <a href={settings.social.facebook} target="_blank" rel="noopener" aria-label="Facebook" className="hover:text-white transition">
                <FiFacebook size={13} />
              </a>
            )}
            {settings.social.instagram && (
              <a href={settings.social.instagram} target="_blank" rel="noopener" aria-label="Instagram" className="hover:text-white transition">
                <FiInstagram size={13} />
              </a>
            )}
          </div>
        </div>
      </div>

      {/* Main bar */}
      <div className="bg-white/95 backdrop-blur border-b border-surface-line">
        <div className="container-x flex items-center justify-between h-[72px]">
          <Link href="/" className="flex items-center gap-3 shrink-0" aria-label={settings.brand_name}>
            {settings.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={settings.logo_url} alt={settings.brand_name} className="h-11 w-auto" />
            ) : (
              <span className="font-display text-lg font-bold text-brand">{settings.brand_name}</span>
            )}
          </Link>

          <nav className="hidden lg:flex items-center gap-0.5" aria-label="Primary">
            {nav.map((item) => (
              <DesktopNavItem key={item.id} item={item} pathname={pathname} />
            ))}
          </nav>

          <div className="hidden lg:flex items-center gap-3 shrink-0">
            <Link
              href="/contact"
              className="inline-flex items-center gap-1.5 bg-brand text-white text-sm font-semibold px-4 py-2.5 rounded-full hover:bg-brand-600 hover:shadow-soft transition"
            >
              Find My Therapist <FiArrowRight />
            </Link>
          </div>

          <button
            className="lg:hidden p-2 text-ink"
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen((v) => !v)}
          >
            {mobileOpen ? <FiX size={24} /> : <FiMenu size={24} />}
          </button>
        </div>
      </div>

      {/* Mobile drawer */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="lg:hidden fixed inset-0 bg-black/40 z-40"
              onClick={() => setMobileOpen(false)}
            />
            <motion.div
              initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }}
              transition={{ type: "tween", duration: 0.25, ease: "easeOut" }}
              className="lg:hidden fixed top-0 right-0 bottom-0 w-[85vw] max-w-sm bg-white z-50 shadow-card flex flex-col"
            >
              <div className="flex items-center justify-between p-4 border-b border-surface-line shrink-0">
                <Link href="/" className="flex items-center gap-2" onClick={() => setMobileOpen(false)}>
                  {settings.logo_url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={settings.logo_url} alt={settings.brand_name} className="h-9 w-auto" />
                  )}
                </Link>
                <button onClick={() => setMobileOpen(false)} aria-label="Close menu" className="p-2">
                  <FiX size={22} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto px-3 py-4">
                {nav.map((item) => <MobileNavSection key={item.id} item={item} pathname={pathname} />)}
              </div>

              <div className="p-4 border-t border-surface-line space-y-2 shrink-0">
                <Link
                  href="/contact"
                  className="w-full inline-flex justify-center items-center gap-2 bg-brand text-white font-semibold px-4 py-3 rounded-full hover:bg-brand-600 transition"
                  onClick={() => setMobileOpen(false)}
                >
                  Find My Therapist <FiArrowRight />
                </Link>
                {settings.primary_phone && (
                  <a
                    href={`tel:${settings.primary_phone}`}
                    className="w-full inline-flex justify-center items-center gap-2 border border-brand text-brand font-semibold px-4 py-3 rounded-full hover:bg-brand hover:text-white transition"
                  >
                    <FiPhone /> {settings.primary_phone}
                  </a>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </header>
  );
}

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

function DesktopNavItem({ item, pathname }: { item: NavItem; pathname: string }) {
  const has = !!(item.children && item.children.length);
  const active = isActive(pathname, item.href) || (item.children ?? []).some((c) => isActive(pathname, c.href));
  const useMega = has && (item.children!.length >= 8);

  return (
    <div className="group relative">
      <Link
        href={item.href}
        className={`px-3 py-2 inline-flex items-center gap-1 text-sm font-medium rounded-md transition ${
          active ? "text-brand" : "text-ink hover:text-brand"
        }`}
      >
        {item.label}
        {has && <FiChevronDown size={13} className="opacity-70 group-hover:rotate-180 transition-transform duration-200" />}
        {active && (
          <motion.span
            layoutId="nav-underline"
            className="absolute -bottom-[1px] left-3 right-3 h-0.5 bg-brand rounded-full"
          />
        )}
      </Link>

      {has && (
        <div
          className={`pointer-events-none group-hover:pointer-events-auto opacity-0 group-hover:opacity-100 translate-y-1 group-hover:translate-y-0 transition-all duration-200 absolute top-full ${useMega ? "left-1/2 -translate-x-1/2" : "left-0"} pt-2 z-50`}
        >
          <div className={`bg-white border border-surface-line rounded-2xl shadow-card overflow-hidden ${useMega ? "w-[640px] p-4" : "min-w-56 py-2"}`}>
            {useMega ? (
              <div className="grid grid-cols-2 gap-1">
                {item.children!.map((c) => (
                  <Link
                    key={c.id}
                    href={c.href}
                    className={`flex items-start gap-3 px-3 py-2.5 rounded-xl hover:bg-surface transition group/item ${
                      isActive(pathname, c.href) ? "bg-brand-50" : ""
                    }`}
                  >
                    <span className="mt-1 w-1.5 h-1.5 rounded-full bg-brand/50 group-hover/item:bg-brand transition shrink-0" />
                    <span className="text-sm font-medium text-ink group-hover/item:text-brand transition">{c.label}</span>
                  </Link>
                ))}
              </div>
            ) : (
              item.children!.map((c) => (
                <Link
                  key={c.id}
                  href={c.href}
                  className={`block px-4 py-2 text-sm transition ${
                    isActive(pathname, c.href)
                      ? "text-brand bg-brand-50"
                      : "text-ink hover:bg-surface hover:text-brand"
                  }`}
                >
                  {c.label}
                </Link>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function MobileNavSection({ item, pathname }: { item: NavItem; pathname: string }) {
  const has = !!(item.children && item.children.length);
  const sectionActive = isActive(pathname, item.href) || (item.children ?? []).some((c) => isActive(pathname, c.href));
  const [open, setOpen] = useState(sectionActive);

  if (!has) {
    return (
      <Link
        href={item.href}
        className={`flex items-center justify-between px-3 py-3 rounded-xl text-base font-medium ${
          sectionActive ? "bg-brand-50 text-brand" : "text-ink hover:bg-surface"
        }`}
      >
        {item.label}
      </Link>
    );
  }

  return (
    <div className="mb-1">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`w-full flex items-center justify-between px-3 py-3 rounded-xl text-base font-medium ${
          sectionActive ? "bg-brand-50 text-brand" : "text-ink hover:bg-surface"
        }`}
        aria-expanded={open}
      >
        <span>{item.label}</span>
        <FiChevronDown className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="pl-5 pr-2 py-1 space-y-0.5">
              {item.children!.map((c) => (
                <Link
                  key={c.id}
                  href={c.href}
                  className={`block px-3 py-2 rounded-lg text-sm ${
                    isActive(pathname, c.href) ? "text-brand bg-brand-50" : "text-ink-muted hover:bg-surface hover:text-ink"
                  }`}
                >
                  {c.label}
                </Link>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
