import Reveal from "./Reveal";
import { FiArrowUpRight } from "react-icons/fi";
import type { PressMention } from "@/lib/queries";

export default function PressMentionSection({ mentions }: { mentions: PressMention[] }) {
  if (!mentions.length) return null;

  // First mention gets prominence ("Featured In" outlet card).
  // Any remaining mentions render as certification / badge tiles to the right.
  const [featured, ...badges] = mentions;
  const hasBadges = badges.length > 0;

  return (
    <section className="section bg-cream-alt border-y border-surface-line">
      <div className="container-x">
        <Reveal>
          <div className="text-center max-w-2xl mx-auto mb-12 sm:mb-14">
            <span className="eyebrow center">Featured In</span>
            <h2 className="mt-5 display text-4xl sm:text-5xl md:text-6xl text-ink leading-[1.05]">
              Recognized for the{" "}
              <span className="italic-accent">work we do.</span>
            </h2>
          </div>
        </Reveal>

        <div
          className={`grid gap-6 lg:gap-8 ${
            hasBadges ? "lg:grid-cols-12" : "lg:grid-cols-1 max-w-2xl mx-auto"
          }`}
        >
          {/* FEATURED OUTLET CARD */}
          <Reveal className={hasBadges ? "lg:col-span-7" : ""}>
            <a
              href={featured.url}
              target="_blank"
              rel="noopener"
              aria-label={`${featured.outlet}${featured.title ? ` — ${featured.title}` : ""}`}
              className="group relative flex flex-col h-full bg-white border border-surface-line shadow-soft hover:shadow-card transition-all duration-500 hover:-translate-y-1 p-8 sm:p-10 lg:p-12"
              style={{ borderRadius: "24px 0 24px 24px" }}
            >
              <span
                className="text-[11px] font-semibold uppercase tracking-[0.2em]"
                style={{ color: "#E1B878" }}
              >
                Featured Story
              </span>

              {featured.logo_url ? (
                <div className="mt-6 flex items-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={featured.logo_url}
                    alt={featured.outlet}
                    className="h-16 sm:h-20 lg:h-24 w-auto object-contain"
                  />
                </div>
              ) : (
                <div className="mt-6 font-display text-3xl sm:text-4xl text-ink">
                  {featured.outlet}
                </div>
              )}

              {featured.title && (
                <h3 className="mt-6 font-display text-xl sm:text-2xl lg:text-[1.65rem] leading-snug text-ink max-w-xl">
                  &ldquo;{featured.title}&rdquo;
                </h3>
              )}

              <span
                className="mt-7 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em]"
                style={{ color: "#66202A" }}
              >
                Read the article
                <FiArrowUpRight
                  className="transition-transform duration-300 group-hover:translate-x-1 group-hover:-translate-y-0.5"
                />
              </span>
            </a>
          </Reveal>

          {/* CERTIFICATION / BADGE TILES */}
          {hasBadges && (
            <div className="lg:col-span-5 grid sm:grid-cols-2 lg:grid-cols-1 gap-6 lg:gap-8">
              {badges.slice(0, 2).map((b, i) => (
                <Reveal key={b.id} delay={(i + 1) * 0.06}>
                  <a
                    href={b.url || "#"}
                    target={b.url ? "_blank" : undefined}
                    rel={b.url ? "noopener" : undefined}
                    aria-label={`${b.outlet}${b.title ? ` — ${b.title}` : ""}`}
                    className="group flex flex-col items-center justify-center text-center h-full bg-white border border-surface-line shadow-soft hover:shadow-card transition-all duration-500 hover:-translate-y-1 p-8 lg:p-10 min-h-[180px]"
                    style={{ borderRadius: "24px 0 24px 24px" }}
                  >
                    {b.logo_url ? (
                      <>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={b.logo_url}
                          alt={b.outlet}
                          className="h-16 sm:h-20 w-auto object-contain"
                        />
                        {b.title && (
                          <p className="mt-4 text-xs font-semibold uppercase tracking-[0.16em] text-ink-soft">
                            {b.title}
                          </p>
                        )}
                      </>
                    ) : (
                      <span className="font-display text-xl sm:text-2xl text-ink">
                        {b.outlet}
                      </span>
                    )}
                  </a>
                </Reveal>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
