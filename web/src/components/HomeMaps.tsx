import Reveal from "./Reveal";
import { FiMapPin } from "react-icons/fi";

const ADDRESSES: { label: string; address: string }[] = [
  {
    label: "East Las Vegas",
    address: "3430 E Russell Rd Ste 315, Las Vegas, NV 89120",
  },
  {
    label: "Northwest Las Vegas",
    address: "6955 N Durango Drive Unit 1004, Las Vegas, NV 89149",
  },
];

export default function HomeMaps() {
  return (
    <section className="section bg-cream-alt border-t border-surface-line">
      <div className="container-x">
        <Reveal>
          <div className="text-center max-w-2xl mx-auto mb-12 sm:mb-14">
            <span className="eyebrow center">Visit Us</span>
            <h2 className="mt-5 display text-4xl sm:text-5xl md:text-6xl text-ink leading-[1.05]">
              Two Locations.{" "}
              <span className="italic-accent">One Collective.</span>
            </h2>
            <p className="mt-5 text-base sm:text-lg text-ink-muted leading-relaxed">
              In-person sessions are available at both of our Las Vegas offices.
              Telehealth is available throughout Nevada.
            </p>
          </div>
        </Reveal>

        <div className="grid gap-6 lg:gap-8 lg:grid-cols-2">
          {ADDRESSES.map((loc, i) => (
            <Reveal key={loc.address} delay={i * 0.08}>
              <div className="h-full bg-white rounded-3xl border border-surface-line shadow-soft overflow-hidden flex flex-col">
                <div className="relative h-80 sm:h-96 w-full bg-cream-alt">
                  <iframe
                    src={`https://www.google.com/maps?q=${encodeURIComponent(
                      loc.address,
                    )}&output=embed`}
                    title={`Map of ${loc.label} office at ${loc.address}`}
                    loading="lazy"
                    referrerPolicy="no-referrer-when-downgrade"
                    className="absolute inset-0 w-full h-full border-0"
                    allowFullScreen
                  />
                </div>
                <div className="p-6 sm:p-7 flex items-start gap-3">
                  <span
                    aria-hidden
                    className="mt-0.5 w-9 h-9 rounded-full grid place-items-center shrink-0"
                    style={{ backgroundColor: "rgba(225,184,120,0.2)", color: "#66202A" }}
                  >
                    <FiMapPin size={16} />
                  </span>
                  <div className="flex-1 min-w-0">
                    <div
                      className="text-[11px] font-semibold uppercase tracking-[0.18em]"
                      style={{ color: "#E1B878" }}
                    >
                      {loc.label}
                    </div>
                    <p className="mt-1 font-display text-lg sm:text-xl text-ink leading-snug">
                      {loc.address}
                    </p>
                    <a
                      href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                        loc.address,
                      )}`}
                      target="_blank"
                      rel="noopener"
                      className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.14em]"
                      style={{ color: "#66202A" }}
                    >
                      Get Directions
                    </a>
                  </div>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
