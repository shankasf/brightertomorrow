import Link from "next/link";
import Reveal from "./Reveal";
import { FiPhone, FiMapPin, FiBookOpen } from "react-icons/fi";
import type { SiteSettings } from "@/lib/queries";

/**
 * 3-card row directly under the hero.
 * Mirrors brightertomorrowtherapy.com:
 *   1. Customer Service  (cream card, wine accent)
 *   2. Service Areas     (wine card, gold accent)
 *   3. Journal of the Month / Free Resources  (peach/gold card, wine accent)
 */
const AI_PHONE_DISPLAY = "(725) 465-2385";
const AI_PHONE_TEL = "+17254652385";

export default function HomeFeatureRow({ settings }: { settings: SiteSettings }) {
  const phone = settings.primary_phone ?? "725-238-6990";
  return (
    <section className="bg-cream-alt py-14 md:py-16 relative">
      <div className="container-x">
        <div className="grid md:grid-cols-3 gap-6 lg:gap-7">
          {/* Card 1 — Book by phone (AI 24/7 + human fallback) */}
          <Reveal>
            <article
              className="h-full p-6 sm:p-8 lg:p-9 text-center flex flex-col"
              style={{
                backgroundColor: "#F4F4F4",
                borderRadius: "20px 0 20px 20px",
              }}
            >
              <span
                className="self-center inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.18em] px-3 py-1.5 mb-5"
                style={{
                  backgroundColor: "#66202A",
                  color: "#E1B878",
                  borderRadius: "20px 0 20px 20px",
                }}
              >
                <span
                  aria-hidden
                  className="inline-block w-1.5 h-1.5 rounded-full animate-pulse"
                  style={{ backgroundColor: "#E1B878" }}
                />
                Available 24 / 7
              </span>

              <div
                className="mx-auto mb-5 grid place-items-center w-14 h-14 rounded-full"
                style={{ backgroundColor: "#66202A" }}
              >
                <FiPhone size={22} className="text-white" />
              </div>

              <h3
                className="font-display text-[1.6rem] font-bold tracking-[-0.012em]"
                style={{ color: "#66202A" }}
              >
                Book by Phone
              </h3>

              <p className="mt-3 text-ink-soft leading-relaxed text-[14px]">
                Talk to our AI assistant anytime &mdash; day or night &mdash;
                to schedule your appointment.
              </p>

              <a
                href={`tel:${AI_PHONE_TEL}`}
                aria-label={`Call our AI booking line at ${AI_PHONE_DISPLAY}, available 24/7`}
                className="mt-4 inline-block font-display text-[1.35rem] sm:text-[1.65rem] font-bold tracking-tight tabular hover:underline whitespace-nowrap"
                style={{ color: "#66202A" }}
              >
                {AI_PHONE_DISPLAY}
              </a>

              <div className="mt-6 pt-5 border-t border-ink/10">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-soft">
                  Trouble booking? Speak with our team
                </p>
                <a
                  href={`tel:${phone}`}
                  aria-label={`Call our team at ${phone}, available Monday through Friday 9am to 5pm`}
                  className="mt-2 inline-block font-semibold text-[15px] tabular hover:underline"
                  style={{ color: "#66202A" }}
                >
                  {phone}
                </a>
                <p className="mt-1 text-[12px] text-ink-soft">
                  Mon &ndash; Fri &middot; 9:00 AM &ndash; 5:00 PM
                </p>
              </div>
            </article>
          </Reveal>

          {/* Card 2 — Service Areas (wine) */}
          <Reveal delay={0.06}>
            <article
              className="h-full p-6 sm:p-8 lg:p-9 text-center text-white"
              style={{
                backgroundColor: "#66202A",
                borderRadius: "20px 0 20px 20px",
              }}
            >
              <div
                className="mx-auto mb-5 grid place-items-center w-14 h-14 rounded-full"
                style={{ backgroundColor: "#E1B878" }}
              >
                <FiMapPin size={22} style={{ color: "#66202A" }} />
              </div>
              <h3
                className="font-display text-[1.6rem] font-bold tracking-[-0.012em]"
                style={{ color: "#E1B878" }}
              >
                Service Areas
              </h3>
              <p className="mt-4 text-white/90 leading-relaxed text-[15px]">
                Serving Clients in the following areas in Nevada: Henderson,
                Las Vegas, Summerlin, North Las Vegas
              </p>
              <p className="mt-2 text-white/80 leading-relaxed text-[15px]">
                Telehealth: Reno, Sparks, Mesquite, Carson City, and Pahrump
              </p>
            </article>
          </Reveal>

          {/* Card 3 — Journal / Free Resources */}
          <Reveal delay={0.12}>
            <article
              className="h-full p-6 sm:p-8 lg:p-9 text-center"
              style={{
                backgroundColor: "#FFBC7D",
                borderRadius: "20px 0 20px 20px",
              }}
            >
              <div
                className="mx-auto mb-5 grid place-items-center w-14 h-14 rounded-full"
                style={{ backgroundColor: "#66202A" }}
              >
                <FiBookOpen size={22} className="text-white" />
              </div>
              <h3
                className="font-display text-[1.6rem] font-bold tracking-[-0.012em]"
                style={{ color: "#66202A" }}
              >
                Journal of the Month and Free Resources
              </h3>
              <Link
                href="/blog"
                className="mt-5 inline-flex items-center gap-2 text-[12px] font-bold uppercase tracking-[0.18em] hover:opacity-80 transition"
                style={{ color: "#66202A" }}
              >
                Click Here
              </Link>
            </article>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
