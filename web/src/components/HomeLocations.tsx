import Link from "next/link";
import Reveal from "./Reveal";
import { FiMapPin, FiPhone, FiVideo } from "react-icons/fi";
import type { Location } from "@/lib/queries";

export default function HomeLocations({ locations }: { locations: Location[] }) {
  return (
    <section className="section">
      <div className="container-x">
        <Reveal>
          <div className="text-center max-w-2xl mx-auto mb-12">
            <span className="text-xs uppercase tracking-[0.2em] text-brand font-semibold">Locations</span>
            <h2 className="mt-2 text-3xl md:text-4xl font-bold text-ink">
              Two Locations. One Collective. All of Nevada.
            </h2>
          </div>
        </Reveal>
        <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-6">
          {locations.map((l, i) => (
            <Reveal key={l.id} delay={i * 0.05}>
              <div className="h-full bg-white rounded-2xl border border-surface-line p-6 shadow-soft hover:shadow-card transition">
                <div className="w-11 h-11 rounded-full bg-brand-50 text-brand grid place-items-center mb-4">
                  {l.is_telehealth ? <FiVideo size={20} /> : <FiMapPin size={20} />}
                </div>
                <h3 className="font-display text-lg font-semibold text-ink">{l.name}</h3>
                {l.address1 && (
                  <p className="text-sm text-ink-muted mt-2">
                    {l.address1}<br />
                    {[l.city, l.state, l.postal_code].filter(Boolean).join(", ")}
                  </p>
                )}
                {l.is_telehealth && (
                  <p className="text-sm text-ink-muted mt-2">
                    HIPAA-compliant video sessions anywhere in Nevada.
                  </p>
                )}
                {l.phone && (
                  <a href={`tel:${l.phone}`} className="mt-4 inline-flex items-center gap-2 text-sm text-brand font-semibold">
                    <FiPhone /> {l.phone}
                  </a>
                )}
              </div>
            </Reveal>
          ))}
        </div>
        <Reveal delay={0.2}>
          <div className="mt-10 text-center">
            <Link href="/contact" className="btn-primary">The First Step Is Choosing to Take It.</Link>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
