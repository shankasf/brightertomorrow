"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  FiMenu, FiX, FiPhone, FiChevronDown, FiArrowRight,
  FiFacebook, FiInstagram, FiMapPin,
} from "react-icons/fi";
import type { NavItem, SiteSettings } from "@/lib/queries";

// Hard-coded to match live brightertomorrowtherapy.com utility bar verbatim.
// (Live site keeps these in WordPress widget settings, not the DB.)
const OFFICE_1 = "3430 E Russell Rd Ste 315 Las Vegas, Nevada 89120";
const OFFICE_2 = "6955 N Durango Dr. Unit 1004 Las Vegas, Nevada 89149";
const UTILITY_TAGLINE =
  "In-person & telehealth therapy for individuals, couples & families — evenings & weekends at both locations.";

// Items that should render as a single link, never as a dropdown.
// /team renders one mixed grid now, so its sub-team children are redundant.
const FLAT_HREFS = new Set<string>(["/team"]);

function flattenNav(items: NavItem[]): NavItem[] {
  return items.map((it) =>
    FLAT_HREFS.has(it.href) ? { ...it, children: [] } : it,
  );
}

export default function SiteHeader({ settings, nav }: { settings: SiteSettings; nav: NavItem[] }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const pathname = usePathname();
  const navFlat = flattenNav(nav);

  useEffect(() => { setMobileOpen(false); }, [pathname]);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header className="sticky top-0 z-40">
      {/* ───── Wine utility bar (matches live #66202A) ───── */}
      <AnimatePresence initial={false}>
        {!scrolled && (
          <motion.div
            key="utility"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="hidden md:block text-white text-[13.5px] overflow-hidden"
            style={{ backgroundColor: "#66202A" }}
          >
            <div className="container-x flex items-center justify-between gap-6 py-3">
              {/* Addresses on left */}
              <div className="flex items-center gap-5 text-white/95 leading-snug">
                <span className="flex items-start gap-2 max-w-[300px]">
                  <FiMapPin size={13} className="text-brand mt-[3px] shrink-0" />
                  <span>{OFFICE_1}</span>
                </span>
                <span className="hidden xl:flex items-start gap-2 max-w-[300px]">
                  <FiMapPin size={13} className="text-brand mt-[3px] shrink-0" />
                  <span>{OFFICE_2}</span>
                </span>
              </div>

              {/* Tagline (centered, hidden on smaller widths) */}
              <p className="hidden lg:block flex-1 text-center text-white/90 max-w-[700px] leading-snug">
                {UTILITY_TAGLINE}
              </p>

              {/* Phone + socials on right */}
              <div className="flex items-center gap-4 shrink-0">
                {settings.primary_phone && (
                  <a
                    href={`tel:${settings.primary_phone}`}
                    className="inline-flex items-center gap-1.5 text-white hover:text-brand transition tabular-nums font-medium"
                  >
                    <FiPhone size={13} className="text-brand" />
                    {settings.primary_phone}
                  </a>
                )}
                <span aria-hidden className="w-px h-4 bg-white/25" />
                {settings.social.facebook && (
                  <a
                    href={settings.social.facebook}
                    target="_blank"
                    rel="noopener"
                    aria-label="Facebook"
                    className="text-white/90 hover:text-brand transition"
                  >
                    <FiFacebook size={15} />
                  </a>
                )}
                {settings.social.instagram && (
                  <a
                    href={settings.social.instagram}
                    target="_blank"
                    rel="noopener"
                    aria-label="Instagram"
                    className="text-white/90 hover:text-brand transition"
                  >
                    <FiInstagram size={15} />
                  </a>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ───── Main nav bar ───── */}
      <motion.div
        animate={{
          height: scrolled ? 64 : 88,
          backgroundColor: "rgba(255,255,255,0.96)",
        }}
        transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
        className="backdrop-blur-md border-b border-surface-line/70"
      >
        <div className="container-x h-full flex items-center justify-between gap-6">
          <Link href="/" className="flex items-center gap-3 shrink-0" aria-label={settings.brand_name}>
            {settings.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={settings.logo_url}
                alt={settings.brand_name}
                className={`w-auto transition-all duration-300 ${scrolled ? "h-10" : "h-14"}`}
              />
            ) : (
              <span className="font-display text-[1.35rem] font-bold tracking-tight text-ink">
                {settings.brand_name}
              </span>
            )}
          </Link>

          <nav className="hidden lg:flex items-center gap-1" aria-label="Primary">
            {navFlat.map((item) => (
              <DesktopNavItem key={item.id} item={item} pathname={pathname} />
            ))}
          </nav>

          {/* Wine "Get Scheduled" CTA — matches live red/burgundy button */}
          <div className="hidden lg:flex items-center shrink-0">
            <Link
              href="/contact"
              className="group inline-flex items-center gap-2 text-white text-[12px] font-semibold uppercase tracking-[0.14em] px-5 py-3 hover:opacity-90 transition"
              style={{ backgroundColor: "#66202A", borderRadius: "20px 0 20px 20px" }}
            >
              Get Scheduled
              <FiArrowRight className="transition-transform duration-300 group-hover:translate-x-0.5" size={13} />
            </Link>
          </div>

          <button
            className="lg:hidden p-2 -mr-2 text-ink rounded-full hover:bg-cream-alt transition"
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen((v) => !v)}
          >
            {mobileOpen ? <FiX size={22} /> : <FiMenu size={22} />}
          </button>
        </div>
      </motion.div>

      {/* Mobile drawer */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="lg:hidden fixed inset-0 bg-ink/30 backdrop-blur-sm z-40"
              onClick={() => setMobileOpen(false)}
            />
            <motion.div
              initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }}
              transition={{ type: "spring", stiffness: 320, damping: 34 }}
              className="lg:hidden fixed top-0 right-0 bottom-0 w-[88vw] max-w-sm bg-cream z-50 shadow-card flex flex-col"
            >
              <div className="flex items-center justify-between px-5 py-4 border-b border-surface-line shrink-0">
                <Link href="/" className="flex items-center gap-2" onClick={() => setMobileOpen(false)}>
                  {settings.logo_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={settings.logo_url} alt={settings.brand_name} className="h-9 w-auto" />
                  ) : (
                    <span className="font-display text-lg font-bold text-ink">{settings.brand_name}</span>
                  )}
                </Link>
                <button
                  onClick={() => setMobileOpen(false)}
                  aria-label="Close menu"
                  className="w-9 h-9 grid place-items-center rounded-full hover:bg-cream-alt text-ink/70 hover:text-ink transition"
                >
                  <FiX size={20} strokeWidth={1.75} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto px-4 py-5">
                <div className="eyebrow-bare text-[10px] text-brand mb-3 px-2">Menu</div>
                {navFlat.map((item) => <MobileNavSection key={item.id} item={item} pathname={pathname} />)}
              </div>

              <div className="px-4 pb-5 pt-4 border-t border-surface-line space-y-2.5 shrink-0 bg-cream-alt/40">
                <Link
                  href="/contact"
                  className="w-full inline-flex justify-center items-center gap-2 text-white font-semibold uppercase tracking-[0.14em] text-[13px] px-4 py-3.5 transition"
                  style={{ backgroundColor: "#66202A", borderRadius: "20px 0 20px 20px" }}
                  onClick={() => setMobileOpen(false)}
                >
                  Get Scheduled <FiArrowRight size={14} />
                </Link>
                {settings.primary_phone && (
                  <a
                    href={`tel:${settings.primary_phone}`}
                    className="w-full inline-flex justify-center items-center gap-2 border border-ink/15 text-ink font-semibold text-[14px] px-4 py-3.5 rounded-full hover:border-ink/40 transition"
                  >
                    <FiPhone size={14} /> {settings.primary_phone}
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
        className={`relative px-3.5 py-2 inline-flex items-center gap-1.5 text-[14px] font-semibold tracking-[-0.005em] transition-colors duration-200 ${
          active ? "text-ink" : "text-ink/80 hover:text-ink"
        }`}
      >
        <span>{item.label}</span>
        {has && (
          <FiChevronDown
            size={12}
            strokeWidth={2.25}
            className="opacity-60 transition-transform duration-300 group-hover:rotate-180 group-hover:opacity-100"
          />
        )}
        {active && (
          <motion.span
            layoutId="nav-underline"
            className="absolute -bottom-[6px] left-3.5 right-3.5 h-[2px] rounded-full origin-center"
            style={{ backgroundColor: "#66202A" }}
            transition={{ type: "spring", stiffness: 380, damping: 30 }}
          />
        )}
      </Link>

      {has && (
        <div
          className={`pointer-events-none group-hover:pointer-events-auto opacity-0 group-hover:opacity-100 translate-y-1 group-hover:translate-y-0 transition-all duration-200 absolute top-full ${useMega ? "left-1/2 -translate-x-1/2 group-hover:-translate-x-1/2" : "left-0"} pt-3 z-50`}
        >
          <div className={`bg-white border border-surface-line rounded-2xl shadow-card overflow-hidden ${useMega ? "w-[680px] p-5" : "min-w-60 p-2.5"}`}>
            {useMega ? (
              <>
                <div className="eyebrow-bare text-[10px] text-brand px-2 pb-3">{item.label}</div>
                <div className="grid grid-cols-2 gap-1">
                  {item.children!.map((c) => (
                    <Link
                      key={c.id}
                      href={c.href}
                      className={`flex items-center gap-3 px-3 py-3 rounded-xl transition-all duration-200 group/item ${
                        isActive(pathname, c.href)
                          ? "bg-cream-alt"
                          : "hover:bg-cream-alt/70"
                      }`}
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-brand/40 group-hover/item:bg-brand-700 transition shrink-0" />
                      <span className="text-[14px] font-medium text-ink/85 group-hover/item:text-ink transition">
                        {c.label}
                      </span>
                    </Link>
                  ))}
                </div>
              </>
            ) : (
              item.children!.map((c) => (
                <Link
                  key={c.id}
                  href={c.href}
                  className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-[14px] transition-all duration-200 ${
                    isActive(pathname, c.href)
                      ? "text-ink bg-cream-alt font-medium"
                      : "text-ink/80 hover:bg-cream-alt/70 hover:text-ink"
                  }`}
                >
                  <span className={`w-1 h-1 rounded-full transition ${isActive(pathname, c.href) ? "bg-brand-700" : "bg-brand/50"}`} />
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
        className={`flex items-center justify-between px-3 py-3.5 rounded-xl font-display text-[18px] font-semibold tracking-[-0.01em] transition ${
          sectionActive ? "text-ink bg-cream-deep/60" : "text-ink/85 hover:bg-cream-alt"
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
        className={`w-full flex items-center justify-between px-3 py-3.5 rounded-xl font-display text-[18px] font-semibold tracking-[-0.01em] transition ${
          sectionActive ? "text-ink bg-cream-deep/60" : "text-ink/85 hover:bg-cream-alt"
        }`}
        aria-expanded={open}
      >
        <span>{item.label}</span>
        <FiChevronDown
          size={16}
          strokeWidth={2}
          className={`transition-transform duration-300 text-ink/60 ${open ? "rotate-180" : ""}`}
        />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="pl-4 pr-2 py-1 space-y-0.5 border-l border-surface-line ml-4 mt-1">
              {item.children!.map((c) => (
                <Link
                  key={c.id}
                  href={c.href}
                  className={`block px-3 py-2.5 rounded-lg text-[14.5px] transition ${
                    isActive(pathname, c.href)
                      ? "text-ink font-medium"
                      : "text-ink-muted hover:text-ink"
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
