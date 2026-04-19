import Link from "next/link";
import Reveal from "./Reveal";
import { FiPhone, FiMapPin, FiClock, FiArrowRight } from "react-icons/fi";
import type { SiteSettings, Location } from "@/lib/queries";

export default function AppointmentSection({
  settings, locations,
}: { settings: SiteSettings; locations: Location[] }) {
  return (
    <section className="section bg-surface-alt">
      <div className="container-x">
        <Reveal>
          <div className="text-center max-w-2xl mx-auto mb-10">
            <span className="text-xs uppercase tracking-[0.2em] text-brand font-semibold">Appointment</span>
            <h2 className="mt-2 text-3xl md:text-4xl font-bold text-ink">Book An Appointment</h2>
            <p className="mt-3 text-ink-muted">Reach out and we'll contact you shortly to get started.</p>
          </div>
        </Reveal>
        <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-4 max-w-5xl mx-auto">
          <Reveal>
            <div className="h-full bg-white rounded-2xl border border-surface-line p-6 shadow-soft">
              <div className="w-10 h-10 rounded-full bg-brand-50 text-brand grid place-items-center mb-3">
                <FiPhone size={18} />
              </div>
              <h4 className="font-display font-semibold text-ink">Customer Service</h4>
              {settings.primary_phone && (
                <a href={`tel:${settings.primary_phone}`} className="text-sm text-brand font-semibold mt-1 inline-block">
                  {settings.primary_phone}
                </a>
              )}
              <p className="text-xs text-ink-muted mt-2">
                Mon – Fri 9:00 am – 5:00 pm<br/>Sat – Sun: Closed
              </p>
            </div>
          </Reveal>
          <Reveal delay={0.05}>
            <div className="h-full bg-white rounded-2xl border border-surface-line p-6 shadow-soft">
              <div className="w-10 h-10 rounded-full bg-brand-50 text-brand grid place-items-center mb-3">
                <FiMapPin size={18} />
              </div>
              <h4 className="font-display font-semibold text-ink">Addresses</h4>
              <ul className="text-xs text-ink-muted mt-2 space-y-1.5">
                {locations.filter((l) => !l.is_telehealth).map((l) => (
                  <li key={l.id}>{l.address1}, {l.city}, {l.state} {l.postal_code}</li>
                ))}
                {locations.some((l) => l.is_telehealth) && <li>Telehealth — All of Nevada</li>}
              </ul>
            </div>
          </Reveal>
          <Reveal delay={0.1}>
            <div className="h-full bg-white rounded-2xl border border-surface-line p-6 shadow-soft">
              <div className="w-10 h-10 rounded-full bg-brand-50 text-brand grid place-items-center mb-3">
                <FiClock size={18} />
              </div>
              <h4 className="font-display font-semibold text-ink">Opening Hours</h4>
              <ul className="text-xs text-ink-muted mt-2 space-y-1">
                {Object.entries(settings.business_hours).map(([k, v]) => (
                  <li key={k} className="flex justify-between gap-4">
                    <span>{k}</span><span>{v}</span>
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>
        </div>
        <Reveal delay={0.15}>
          <div className="mt-8 text-center">
            <Link href="/contact" className="btn-primary">Book An Appointment <FiArrowRight /></Link>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
