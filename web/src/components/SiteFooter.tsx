import Link from "next/link";
import type { NavItem, SiteSettings } from "@/lib/queries";
import {
  FiFacebook, FiInstagram, FiPhone, FiMail, FiMapPin,
  FiVideo, FiClock, FiArrowUp, FiChevronRight, FiLock,
} from "react-icons/fi";

const WINE = "#66202A";
const GOLD = "#E1B878";

function ColumnHeading({ children }: { children: React.ReactNode }) {
  return (
    <h4
      className="font-display text-[1.05rem] font-bold tracking-[-0.005em] mb-5"
      style={{ color: GOLD }}
    >
      {children}
    </h4>
  );
}

function FooterLink({ href, label }: { href: string; label: string }) {
  return (
    <li>
      <Link
        href={href}
        className="group inline-flex items-start gap-2 text-[14px] text-white/85 hover:text-white transition-colors"
      >
        <FiChevronRight
          size={13}
          className="mt-1 shrink-0 transition-transform duration-300 group-hover:translate-x-0.5"
          style={{ color: GOLD }}
        />
        <span className="leading-snug">{label}</span>
      </Link>
    </li>
  );
}

function ExternalFooterLink({ href, label }: { href: string; label: string }) {
  return (
    <li>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="group inline-flex items-start gap-2 text-[14px] text-white/85 hover:text-white transition-colors"
      >
        <FiChevronRight
          size={13}
          className="mt-1 shrink-0 transition-transform duration-300 group-hover:translate-x-0.5"
          style={{ color: GOLD }}
        />
        <span className="leading-snug">{label}</span>
      </a>
    </li>
  );
}

const JOTFORM_MATCH_URL = "https://form.jotform.com/253014448330448";

export default function SiteFooter({ settings, nav }: { settings: SiteSettings; nav: NavItem[] }) {
  const year = new Date().getFullYear();
  const navGroups = nav.filter((g) => (g.children ?? []).length > 0);
  const services = navGroups.find((g) => /service/i.test(g.label));
  const specialties = navGroups.find((g) => /special/i.test(g.label));

  return (
    <footer className="mt-20" id="site-footer">
      {/* ───── Wine footer (matches live brightertomorrowtherapy.com #66202A) ───── */}
      <div
        className="relative text-white/85 pt-20 pb-8 overflow-hidden"
        style={{ backgroundColor: WINE }}
      >
        {/* Subtle decorative gold ring */}
        <div
          aria-hidden
          className="pointer-events-none absolute -top-32 -right-24 w-[460px] h-[460px] rounded-full opacity-[0.06]"
          style={{ background: `radial-gradient(closest-side, ${GOLD}, transparent 70%)` }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.04] mix-blend-overlay"
          style={{
            backgroundImage:
              "linear-gradient(to right, rgba(255,255,255,0.6) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.6) 1px, transparent 1px)",
            backgroundSize: "64px 64px",
          }}
        />

        <div className="container-x relative grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-10 lg:gap-12">
          {/* ── Column 1 — Brand + tagline + social ── */}
          <div className="lg:col-span-4">
            <Link
              href="/"
              className="inline-flex items-center gap-3"
              aria-label={settings.brand_name}
            >
              {settings.logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={settings.logo_url}
                  alt={settings.brand_name}
                  className="h-14 w-auto opacity-95"
                />
              ) : (
                <span className="font-display text-2xl font-bold tracking-[-0.01em] text-white">
                  {settings.brand_name}
                </span>
              )}
            </Link>

            <p className="mt-6 text-[14.5px] text-white/70 leading-relaxed max-w-sm">
              {settings.tagline ??
                "In-person & telehealth therapy for individuals, couples, and families across Las Vegas and all of Nevada."}
            </p>

            <div className="mt-8 flex items-center gap-3">
              {settings.social.facebook && (
                <a
                  href={settings.social.facebook}
                  target="_blank"
                  rel="noopener"
                  aria-label="Facebook"
                  className="w-10 h-10 grid place-items-center rounded-full text-white/90 hover:text-white bg-brand/15 hover:bg-brand transition-colors duration-300"
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
                  className="w-10 h-10 grid place-items-center rounded-full text-white/90 hover:text-white bg-brand/15 hover:bg-brand transition-colors duration-300"
                >
                  <FiInstagram size={15} />
                </a>
              )}
            </div>
          </div>

          {/* ── Column 2 — Services ── */}
          {services && (
            <div className="lg:col-span-2">
              <ColumnHeading>Services</ColumnHeading>
              <ul className="space-y-2.5">
                {services.children!.map((c) => (
                  <FooterLink key={c.id} href={c.href} label={c.label} />
                ))}
              </ul>
            </div>
          )}

          {/* ── Column 3 — Specialities ── */}
          {specialties && (
            <div className="lg:col-span-3">
              <ColumnHeading>Specialities</ColumnHeading>
              <ul className="space-y-2.5">
                {specialties.children!.map((c) => (
                  <FooterLink key={c.id} href={c.href} label={c.label} />
                ))}
              </ul>

              <div className="mt-8">
                <ColumnHeading>Important Links</ColumnHeading>
                <ul className="space-y-2.5">
                  <ExternalFooterLink href={JOTFORM_MATCH_URL} label="Find My Therapist" />
                  <FooterLink href="/privacy-policy" label="Privacy Policy" />
                  <FooterLink href="/contact" label="Contact" />
                  <FooterLink href="/faqs" label="FAQs" />
                </ul>
              </div>
            </div>
          )}

          {/* ── Column 4 — Information (phone, email, addresses, hours) ── */}
          <div className="lg:col-span-3">
            <ColumnHeading>Information</ColumnHeading>
            <ul className="space-y-3.5 text-[14px]">
              {settings.primary_phone && (
                <li>
                  <a
                    href={`tel:${settings.primary_phone}`}
                    className="flex items-start gap-3 text-white/85 hover:text-white transition group"
                  >
                    <span
                      className="mt-0.5 w-7 h-7 grid place-items-center rounded-full shrink-0"
                      style={{ backgroundColor: "rgba(225,184,120,0.18)" }}
                    >
                      <FiPhone size={12} style={{ color: GOLD }} />
                    </span>
                    <span className="tabular-nums leading-relaxed pt-1">
                      {settings.primary_phone}
                    </span>
                  </a>
                </li>
              )}
              {settings.primary_email && (
                <li>
                  <a
                    href={`mailto:${settings.primary_email}`}
                    className="flex items-start gap-3 text-white/85 hover:text-white transition min-w-0"
                    title={settings.primary_email}
                  >
                    <span
                      className="mt-0.5 w-7 h-7 grid place-items-center rounded-full shrink-0"
                      style={{ backgroundColor: "rgba(225,184,120,0.18)" }}
                    >
                      <FiMail size={12} style={{ color: GOLD }} />
                    </span>
                    <span className="truncate leading-relaxed pt-1">{settings.primary_email}</span>
                  </a>
                </li>
              )}
              <li className="flex items-start gap-3 text-white/85">
                <span
                  className="mt-0.5 w-7 h-7 grid place-items-center rounded-full shrink-0"
                  style={{ backgroundColor: "rgba(225,184,120,0.18)" }}
                >
                  <FiMapPin size={12} style={{ color: GOLD }} />
                </span>
                <address className="not-italic leading-relaxed pt-0.5">
                  3430 E Russell Rd Ste 315<br />
                  Las Vegas, Nevada 89120
                </address>
              </li>
              <li className="flex items-start gap-3 text-white/85">
                <span
                  className="mt-0.5 w-7 h-7 grid place-items-center rounded-full shrink-0"
                  style={{ backgroundColor: "rgba(225,184,120,0.18)" }}
                >
                  <FiMapPin size={12} style={{ color: GOLD }} />
                </span>
                <address className="not-italic leading-relaxed pt-0.5">
                  6955 N Durango Drive, Unit 1004<br />
                  Las Vegas, Nevada 89149
                </address>
              </li>
              <li className="flex items-start gap-3 text-white/85">
                <span
                  className="mt-0.5 w-7 h-7 grid place-items-center rounded-full shrink-0"
                  style={{ backgroundColor: "rgba(225,184,120,0.18)" }}
                >
                  <FiVideo size={12} style={{ color: GOLD }} />
                </span>
                <span className="leading-relaxed pt-1">Telehealth — All of Nevada</span>
              </li>
            </ul>

            {Object.keys(settings.business_hours).length > 0 && (
              <>
                <div className="mt-8 flex items-center gap-2">
                  <FiClock size={14} style={{ color: GOLD }} />
                  <h4
                    className="font-display text-[1.05rem] font-bold tracking-[-0.005em]"
                    style={{ color: GOLD }}
                  >
                    Opening Hours
                  </h4>
                </div>
                <ul className="mt-4 text-[14px] space-y-2">
                  {Object.entries(settings.business_hours).map(([k, v]) => (
                    <li
                      key={k}
                      className="flex items-baseline justify-between gap-3 pb-2 border-b border-white/10 last:border-0"
                    >
                      <span className="text-white/80 font-medium">{k}</span>
                      <span className="text-white/65 tabular-nums text-right">{v}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>

        {/* Gold hairline divider */}
        <div
          aria-hidden
          className="container-x relative mt-16 pt-px"
          style={{
            borderTop: `1px solid ${GOLD}`,
            opacity: 0.55,
          }}
        />

        {/* Bottom bar */}
        <div className="container-x relative mt-6 flex flex-col md:flex-row items-center justify-between gap-4 text-[12.5px] text-white/65">
          <div className="flex flex-wrap items-center justify-center md:justify-start gap-x-5 gap-y-2">
            <span>
              © {year} {settings.brand_name} Counseling Services. All rights reserved.
            </span>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
            <span className="inline-flex items-center gap-2 text-white/65">
              <span
                aria-hidden
                className="inline-block w-1.5 h-1.5 rounded-full"
                style={{ backgroundColor: GOLD }}
              />
              In-person &amp; online therapy across Nevada
            </span>
            <a
              href={process.env.ADMIN_HOST_URL || "https://admin.brightertomorrowtherapy.com"}
              aria-label="Admin login"
              className="group inline-flex items-center gap-1.5 text-white/65 hover:text-white transition"
            >
              <FiLock size={12} style={{ color: GOLD }} />
              <span>Admin login</span>
            </a>
            <a
              href="#top"
              aria-label="Back to top"
              className="group inline-flex items-center gap-1.5 text-white/65 hover:text-white transition"
            >
              <span>Top</span>
              <FiArrowUp
                size={13}
                className="transition-transform duration-300 group-hover:-translate-y-0.5"
              />
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
