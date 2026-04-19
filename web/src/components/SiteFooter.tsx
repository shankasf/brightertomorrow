import Link from "next/link";
import type { NavItem, SiteSettings } from "@/lib/queries";
import {
  FiFacebook, FiInstagram, FiPhone, FiMail, FiMapPin,
  FiClock, FiArrowRight, FiArrowUp,
} from "react-icons/fi";
import NewsletterForm from "./NewsletterForm";

function FooterNavGroup({ group }: { group: NavItem }) {
  return (
    <div>
      <h4 className="font-display text-sm font-semibold text-white mb-5 tracking-[0.14em] uppercase relative inline-block">
        {group.label}
        <span className="absolute -bottom-1.5 left-0 h-0.5 w-8 rounded-full bg-gradient-to-r from-brand-400 to-brand-200/0" />
      </h4>
      <ul className="space-y-2.5 text-sm text-white/65">
        {(group.children ?? []).map((c) => (
          <li key={c.id}>
            <Link
              href={c.href}
              className="group inline-flex items-center gap-2.5 hover:text-white transition"
            >
              <span className="h-px w-3 bg-white/20 group-hover:w-5 group-hover:bg-brand-300 transition-all duration-300" />
              <span>{c.label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

const NAV_COLS: Record<number, string> = {
  1: "md:grid-cols-1",
  2: "md:grid-cols-2",
  3: "md:grid-cols-3",
  4: "md:grid-cols-4",
};

export default function SiteFooter({ settings, nav }: { settings: SiteSettings; nav: NavItem[] }) {
  const year = new Date().getFullYear();
  const navGroups = nav.filter((g) => (g.children ?? []).length > 0);
  const navColsClass = NAV_COLS[Math.min(navGroups.length, 4)] ?? "md:grid-cols-4";

  return (
    <footer className="mt-24">
      {/* CTA strip */}
      <div className="container-x relative z-10">
        <div className="rounded-3xl bg-gradient-to-br from-brand via-brand-600 to-brand-700 text-white p-8 md:p-10 -mb-16 shadow-card relative overflow-hidden ring-1 ring-white/10">
          <div className="absolute -right-16 -top-16 w-64 h-64 bg-white/10 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute -left-20 -bottom-20 w-56 h-56 bg-brand-300/30 rounded-full blur-3xl pointer-events-none" />
          <div className="relative grid md:grid-cols-[1fr_auto] items-center gap-6">
            <div>
              <div className="text-xs md:text-sm uppercase tracking-[0.22em] text-white/80">Ready to start?</div>
              <h3 className="font-display text-2xl md:text-3xl font-bold mt-2 leading-tight">
                Find a therapist who fits — usually within the same week.
              </h3>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link href="/contact" className="bg-white text-brand font-semibold px-6 py-3 rounded-full hover:bg-brand-50 hover:-translate-y-0.5 transition inline-flex items-center gap-2 shadow-lg shadow-brand-900/20">
                Get Started <FiArrowRight />
              </Link>
              {settings.primary_phone && (
                <a href={`tel:${settings.primary_phone}`} className="border border-white/40 text-white font-semibold px-6 py-3 rounded-full hover:bg-white/10 transition inline-flex items-center gap-2 backdrop-blur">
                  <FiPhone /> {settings.primary_phone}
                </a>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Main */}
      <div className="relative text-white/85 pt-32 pb-10 overflow-hidden isolate">
        {/* Layered background */}
        <div aria-hidden className="absolute inset-0 -z-10 bg-[#2a1b14]" />
        <div
          aria-hidden
          className="absolute inset-0 -z-10 opacity-[0.38] bg-[radial-gradient(60%_50%_at_20%_0%,rgba(185,135,82,0.40),transparent_60%),radial-gradient(45%_45%_at_90%_20%,rgba(102,32,42,0.20),transparent_60%),radial-gradient(55%_45%_at_50%_110%,rgba(59,36,25,0.72),transparent_70%)]"
        />
        <div
          aria-hidden
          className="absolute inset-0 -z-10 opacity-[0.06] mix-blend-overlay"
          style={{
            backgroundImage:
              "linear-gradient(to right, rgba(255,255,255,0.6) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.6) 1px, transparent 1px)",
            backgroundSize: "44px 44px",
          }}
        />
        {/* Accent line under CTA */}
        <div aria-hidden className="container-x absolute top-16 inset-x-0 -z-10">
          <div className="h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
        </div>

        {/* Top: brand + contact strip */}
        <div className="container-x relative grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-10">
          {/* Brand / newsletter */}
          <div className="lg:col-span-5">
            <Link href="/" className="inline-flex items-center gap-3">
              {settings.logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={settings.logo_url} alt={settings.brand_name} className="h-12 w-auto brightness-0 invert opacity-95" />
              ) : (
                <span className="font-display text-2xl font-bold">{settings.brand_name}</span>
              )}
            </Link>
            <p className="mt-5 text-[15px] text-white/70 leading-relaxed max-w-md">
              {settings.tagline ?? "Therapy for children, teens, and adults across Las Vegas and all of Nevada."}
            </p>

            <div className="mt-8 max-w-md">
              <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-brand-300">
                Stay in the loop
              </div>
              <NewsletterForm />
              <p className="mt-2.5 text-xs text-white/45">
                Occasional notes on wellness & new openings. No spam.
              </p>
            </div>

            <div className="mt-8 flex items-center gap-3">
              {settings.social.facebook && (
                <a
                  href={settings.social.facebook}
                  target="_blank"
                  rel="noopener"
                  aria-label="Facebook"
                  className="w-11 h-11 grid place-items-center rounded-full bg-white/5 ring-1 ring-white/10 hover:bg-brand hover:ring-brand hover:-translate-y-0.5 transition-all duration-300"
                >
                  <FiFacebook size={17} />
                </a>
              )}
              {settings.social.instagram && (
                <a
                  href={settings.social.instagram}
                  target="_blank"
                  rel="noopener"
                  aria-label="Instagram"
                  className="w-11 h-11 grid place-items-center rounded-full bg-white/5 ring-1 ring-white/10 hover:bg-brand hover:ring-brand hover:-translate-y-0.5 transition-all duration-300"
                >
                  <FiInstagram size={17} />
                </a>
              )}
            </div>
          </div>

          {/* Locations */}
          <div className="lg:col-span-4">
            <h4 className="font-display text-sm font-semibold text-white mb-5 tracking-[0.14em] uppercase relative inline-block">
              Visit Us
              <span className="absolute -bottom-1.5 left-0 h-0.5 w-8 rounded-full bg-gradient-to-r from-brand-400 to-brand-200/0" />
            </h4>
            <ul className="space-y-3">
              <li className="group flex items-start gap-4 rounded-2xl p-4 bg-white/[0.03] ring-1 ring-white/10 hover:bg-white/[0.06] hover:ring-white/20 transition">
                <span className="mt-0.5 w-9 h-9 grid place-items-center rounded-xl bg-brand/20 text-brand-200 ring-1 ring-brand/30 shrink-0">
                  <FiMapPin size={16} />
                </span>
                <div className="text-sm text-white/75 leading-relaxed">
                  <div className="text-white font-semibold">E Russell Office</div>
                  3430 E Russell Rd Ste 315<br />Las Vegas, NV 89120
                </div>
              </li>
              <li className="group flex items-start gap-4 rounded-2xl p-4 bg-white/[0.03] ring-1 ring-white/10 hover:bg-white/[0.06] hover:ring-white/20 transition">
                <span className="mt-0.5 w-9 h-9 grid place-items-center rounded-xl bg-brand/20 text-brand-200 ring-1 ring-brand/30 shrink-0">
                  <FiMapPin size={16} />
                </span>
                <div className="text-sm text-white/75 leading-relaxed">
                  <div className="text-white font-semibold">N Durango Office</div>
                  6955 N Durango Dr Unit 1004<br />Las Vegas, NV 89149
                </div>
              </li>
            </ul>
          </div>

          {/* Contact + Hours */}
          <div className="lg:col-span-3">
            <h4 className="font-display text-sm font-semibold text-white mb-5 tracking-[0.14em] uppercase relative inline-block">
              Contact
              <span className="absolute -bottom-1.5 left-0 h-0.5 w-8 rounded-full bg-gradient-to-r from-brand-400 to-brand-200/0" />
            </h4>
            <ul className="space-y-3 text-sm text-white/80">
              {settings.primary_phone && (
                <li>
                  <a href={`tel:${settings.primary_phone}`} className="flex items-center gap-3 hover:text-white transition group">
                    <span className="w-9 h-9 grid place-items-center rounded-full bg-white/5 ring-1 ring-white/10 text-brand-300 group-hover:bg-brand group-hover:ring-brand group-hover:text-white transition shrink-0">
                      <FiPhone size={15} />
                    </span>
                    <span className="font-medium tracking-wide">{settings.primary_phone}</span>
                  </a>
                </li>
              )}
              {settings.primary_email && (
                <li>
                  <a
                    href={`mailto:${settings.primary_email}`}
                    className="flex items-center gap-3 hover:text-white transition group min-w-0"
                    title={settings.primary_email}
                  >
                    <span className="w-9 h-9 grid place-items-center rounded-full bg-white/5 ring-1 ring-white/10 text-brand-300 group-hover:bg-brand group-hover:ring-brand group-hover:text-white transition shrink-0">
                      <FiMail size={15} />
                    </span>
                    <span className="truncate">{settings.primary_email}</span>
                  </a>
                </li>
              )}
            </ul>

            {Object.keys(settings.business_hours).length > 0 && (
              <>
                <h4 className="font-display text-sm font-semibold text-white mt-8 mb-4 tracking-[0.14em] uppercase relative inline-block">
                  <span className="inline-flex items-center gap-2">
                    <FiClock className="text-brand-300" /> Hours
                  </span>
                  <span className="absolute -bottom-1.5 left-0 h-0.5 w-8 rounded-full bg-gradient-to-r from-brand-400 to-brand-200/0" />
                </h4>
                <ul className="text-sm divide-y divide-white/5 rounded-xl bg-white/[0.02] ring-1 ring-white/5 overflow-hidden">
                  {Object.entries(settings.business_hours).map(([k, v]) => (
                    <li key={k} className="flex items-baseline justify-between gap-3 px-3.5 py-2.5">
                      <span className="text-white/85 font-medium">{k}</span>
                      <span className="text-white/55 tabular-nums text-right">{v}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>

        {/* Grouped nav */}
        {navGroups.length > 0 && (
          <div className="container-x relative mt-16 pt-10 border-t border-white/10">
            <div className={`grid grid-cols-2 ${navColsClass} gap-y-10 gap-x-8`}>
              {navGroups.map((group) => (
                <FooterNavGroup key={group.id} group={group} />
              ))}
            </div>
          </div>
        )}

        {/* Bottom bar */}
        <div className="container-x relative mt-14 pt-6 border-t border-white/10 flex flex-col md:flex-row items-center justify-between gap-4 text-xs text-white/55">
          <div className="flex flex-wrap items-center justify-center md:justify-start gap-x-5 gap-y-2">
            <span>© {year} {settings.brand_name}. All rights reserved.</span>
            <span aria-hidden className="hidden md:inline text-white/20">•</span>
            <Link href="/privacy" className="hover:text-white transition">Privacy</Link>
            <Link href="/contact" className="hover:text-white transition">Contact</Link>
            <Link href="/faqs" className="hover:text-white transition">FAQs</Link>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-white/50">
              <span aria-hidden className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400/80 mr-2 align-middle shadow-[0_0_0_3px_rgba(16,185,129,0.15)]" />
              In-person & online therapy across Nevada
            </span>
            <a
              href="#top"
              aria-label="Back to top"
              className="w-9 h-9 grid place-items-center rounded-full bg-white/5 ring-1 ring-white/10 hover:bg-brand hover:ring-brand hover:-translate-y-0.5 transition"
            >
              <FiArrowUp size={14} />
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
