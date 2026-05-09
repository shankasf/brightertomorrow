import Link from "next/link";
import Reveal from "./Reveal";
import { FiPhone, FiVideo, FiMapPin } from "react-icons/fi";
import type { Location } from "@/lib/queries";

/**
 * Wine-band locations + telehealth section.
 * Mirrors live "Two Locations. One Collective. All of Nevada."
 */
export default function HomeLocations({ locations }: { locations: Location[] }) {
  return (
    <section
      className="section relative overflow-hidden"
      style={{ backgroundColor: "#66202A" }}
    >
      <div className="container-x">
        <Reveal>
          <div className="text-center max-w-2xl mx-auto mb-14">
            <span className="eyebrow center" style={{ color: "#E1B878" }}>
              Our Locations
            </span>
            <h2 className="display mt-5 text-4xl md:text-5xl text-white leading-[1.05]">
              Two Locations. One Collective.{" "}
              <span className="italic-accent" style={{ color: "#E1B878" }}>
                All of Nevada.
              </span>
            </h2>
          </div>
        </Reveal>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8">
          {locations.map((l, i) => {
            const num = String(i + 1).padStart(2, "0");
            return (
              <Reveal key={l.id} delay={i * 0.05}>
                <article
                  className="group relative h-full p-8 transition-all duration-300 hover:-translate-y-1"
                  style={{
                    backgroundColor: "#F4F4F4",
                    borderRadius: "20px 0 20px 20px",
                  }}
                >
                  <div className="flex items-start justify-between mb-6">
                    <span
                      className="font-display text-sm font-bold tracking-wide"
                      style={{ color: "#E1B878" }}
                    >
                      {num}
                    </span>
                    <span
                      className="w-10 h-10 rounded-full grid place-items-center"
                      style={{ backgroundColor: "#66202A" }}
                      aria-hidden
                    >
                      {l.is_telehealth ? (
                        <FiVideo size={16} className="text-white" />
                      ) : (
                        <FiMapPin size={16} className="text-white" />
                      )}
                    </span>
                  </div>

                  <h3
                    className="font-display text-xl md:text-2xl font-bold text-ink leading-snug"
                  >
                    {l.name}
                  </h3>

                  {l.address1 && (
                    <address className="not-italic text-sm text-ink-soft mt-4 leading-relaxed">
                      {l.address1}<br />
                      {[l.city, l.state, l.postal_code].filter(Boolean).join(", ")}
                    </address>
                  )}

                  {l.is_telehealth && (
                    <p className="text-sm text-ink-soft mt-4 leading-relaxed">
                      Can&rsquo;t come to us? We come to you. Secure,
                      HIPAA-compliant telehealth therapy anywhere in Nevada —
                      Reno, Sparks, Carson City, Mesquite, Pahrump, and beyond.
                    </p>
                  )}

                  {l.phone && (
                    <a
                      href={`tel:${l.phone}`}
                      className="mt-6 inline-flex items-center gap-2 text-sm font-semibold pb-0.5 transition hover:opacity-80"
                      style={{ color: "#66202A", borderBottom: "1px solid #66202A" }}
                    >
                      <FiPhone size={14} /> {l.phone}
                    </a>
                  )}
                </article>
              </Reveal>
            );
          })}
        </div>

        <Reveal delay={0.2}>
          <div className="mt-14 flex justify-center">
            <Link href="/contact" className="btn-primary">
              Make an Appointment
            </Link>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
