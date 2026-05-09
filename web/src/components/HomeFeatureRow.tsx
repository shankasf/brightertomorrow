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
export default function HomeFeatureRow({ settings }: { settings: SiteSettings }) {
  const phone = settings.primary_phone ?? "725-238-6990";
  return (
    <section className="bg-cream-alt py-14 md:py-16 relative">
      <div className="container-x">
        <div className="grid md:grid-cols-3 gap-6 lg:gap-7">
          {/* Card 1 — Customer Service */}
          <Reveal>
            <article
              className="h-full p-8 lg:p-9 text-center"
              style={{
                backgroundColor: "#F4F4F4",
                borderRadius: "20px 0 20px 20px",
              }}
            >
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
                Customer Service
              </h3>
              <p className="mt-4 text-ink-soft leading-relaxed text-[15px]">
                Phone:{" "}
                <a
                  href={`tel:${phone}`}
                  className="font-semibold hover:underline"
                  style={{ color: "#66202A" }}
                >
                  {phone}
                </a>
              </p>
              <p className="mt-2 text-ink-soft text-[15px] leading-relaxed">
                Opening Hours: 9:00 am to 5:00 pm
                <br />
                Sat &ndash; Sun: Closed.
              </p>
            </article>
          </Reveal>

          {/* Card 2 — Service Areas (wine) */}
          <Reveal delay={0.06}>
            <article
              className="h-full p-8 lg:p-9 text-center text-white"
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
              className="h-full p-8 lg:p-9 text-center"
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
