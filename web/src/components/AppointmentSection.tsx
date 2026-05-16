import Link from "next/link";
import Reveal from "./Reveal";
import { FiPhone, FiMail, FiMapPin, FiClock, FiArrowRight, FiCheck } from "react-icons/fi";
import type { SiteSettings, Location } from "@/lib/queries";

export default function AppointmentSection({
  settings, locations,
}: { settings: SiteSettings; locations: Location[] }) {
  const physical = locations.filter((l) => !l.is_telehealth);
  const hasTelehealth = locations.some((l) => l.is_telehealth);

  return (
    <section className="section relative overflow-hidden bg-white">
      <div className="absolute top-0 right-0 w-1/2 h-1/2 bg-grid opacity-40 pointer-events-none [mask-image:radial-gradient(ellipse_at_top_right,black,transparent_70%)]" aria-hidden />

      <div className="container-x relative">
        <Reveal>
          <div className="text-center max-w-2xl mx-auto mb-14">
            <span className="eyebrow center">Appointment</span>
            <h2 className="display mt-5 text-4xl md:text-5xl text-ink leading-[1.05]">
              Book An Appointment
            </h2>
            <p className="mt-4 text-ink-muted text-base md:text-lg leading-relaxed">
              Reach out and we'll contact you shortly to get started.
            </p>
          </div>
        </Reveal>

        <div className="grid lg:grid-cols-12 gap-10 lg:gap-16 items-start">
          {/* LEFT — editorial copy + reassurance */}
          <Reveal className="lg:col-span-5">
            <div>
              <span className="eyebrow">Get in touch</span>
              <h3 className="display mt-4 text-3xl md:text-4xl text-ink leading-[1.1]">
                Ready to take the <span className="italic-accent">first step?</span>
              </h3>
              <p className="mt-5 text-ink-muted leading-relaxed">
                Reach out and we'll contact you shortly to get started. No long forms,
                no pressure — just a calm path to working with a therapist who fits.
              </p>

              <ul className="mt-8 space-y-3.5">
                {[
                  "Free 15-minute consultation",
                  "Most major insurances accepted",
                  "In-person & telehealth available",
                  "Evenings & weekends offered",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-3 text-ink">
                    <span className="mt-0.5 w-5 h-5 rounded-full bg-sage/15 text-sage grid place-items-center flex-shrink-0" aria-hidden>
                      <FiCheck size={12} strokeWidth={3} />
                    </span>
                    <span className="text-sm leading-relaxed">{item}</span>
                  </li>
                ))}
              </ul>

              <p className="mt-8 text-sm text-ink-soft italic leading-relaxed border-l-2 border-brand/30 pl-4">
                Most clients are scheduled within one business day of reaching out.
              </p>
            </div>
          </Reveal>

          {/* RIGHT — calm card with contact details */}
          <Reveal delay={0.1} className="lg:col-span-7">
            <div className="bg-cream-alt rounded-3xl border border-surface-line p-8 md:p-10">
              <div className="grid sm:grid-cols-2 gap-x-8 gap-y-8">
                {/* Phone + Email */}
                <div>
                  <div className="flex items-center gap-2.5 text-brand-700">
                    <FiPhone size={14} />
                    <span className="eyebrow-bare text-brand-700">Customer Service</span>
                  </div>
                  {settings.primary_phone && (
                    <a
                      href={`tel:${settings.primary_phone}`}
                      className="block mt-3 font-display text-xl text-ink hover:text-brand transition"
                    >
                      {settings.primary_phone}
                    </a>
                  )}
                  {settings.primary_email && (
                    <a
                      href={`mailto:${settings.primary_email}`}
                      className="mt-2 inline-flex items-center gap-2 text-sm text-ink-muted hover:text-brand transition break-all"
                    >
                      <FiMail size={13} className="shrink-0" />
                      {settings.primary_email}
                    </a>
                  )}
                  <p className="text-xs text-ink-muted mt-3 leading-relaxed">
                    Mon – Fri 9:00 am – 8:00 pm<br />Sat – Sun 10:00 am – 4:00 pm
                  </p>
                </div>

                {/* Hours */}
                <div>
                  <div className="flex items-center gap-2.5 text-brand-700">
                    <FiClock size={14} />
                    <span className="eyebrow-bare text-brand-700">Opening Hours</span>
                  </div>
                  <ul className="mt-3 space-y-1.5">
                    {Object.entries(settings.business_hours).map(([k, v]) => (
                      <li key={k} className="flex justify-between gap-4 text-xs text-ink-muted">
                        <span className="font-medium text-ink">{k}</span>
                        <span className="tabular-nums">{v}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Addresses — full width */}
                <div className="sm:col-span-2 pt-6 border-t border-surface-line">
                  <div className="flex items-center gap-2.5 text-brand-700">
                    <FiMapPin size={14} />
                    <span className="eyebrow-bare text-brand-700">Addresses</span>
                  </div>
                  <ul className="mt-3 space-y-2">
                    {physical.map((l) => (
                      <li key={l.id} className="text-sm text-ink-muted leading-relaxed">
                        <span className="font-medium text-ink">{l.name}</span>
                        <span className="text-ink-soft"> — {l.address1}, {l.city}, {l.state} {l.postal_code}</span>
                      </li>
                    ))}
                    {hasTelehealth && (
                      <li className="text-sm text-ink-muted leading-relaxed">
                        <span className="font-medium text-ink">Telehealth</span>
                        <span className="text-ink-soft"> — All of Nevada</span>
                      </li>
                    )}
                  </ul>
                </div>
              </div>

              <div className="mt-8 pt-8 border-t border-surface-line">
                <Link href="/contact" className="btn-primary w-full justify-center">
                  Book An Appointment <FiArrowRight />
                </Link>
                <p className="text-xs text-ink-soft text-center mt-4 leading-relaxed">
                  Submitting takes under a minute. We'll reply within one business day.
                </p>
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
