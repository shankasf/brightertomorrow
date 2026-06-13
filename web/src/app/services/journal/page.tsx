import Link from "next/link";
import Image from "next/image";
import Reveal from "@/components/Reveal";
import { FiBookOpen } from "react-icons/fi";
import { getWorkbooks } from "@/lib/queries";
import WorkbookGrid from "./WorkbookGrid";
import { JsonLd, detailPageGraph } from "@/components/StructuredData";

const WINE = "#66202A";
const GOLD = "#E1B878";
const INK = "#192735";

export const metadata = { title: "Journal & Free Resources — Brighter Tomorrow Therapy" };

export default async function JournalPage() {
  const workbooks = await getWorkbooks();

  return (
    <>
      <JsonLd
        data={detailPageGraph({
          name: "Journal & Free Resources — Brighter Tomorrow Therapy",
          description:
            "Practical, therapist-built journals and free downloadable workbooks from Brighter Tomorrow Therapy in Las Vegas, NV — tools to manage chronic pain, track patterns, and support your mental health.",
          path: "/services/journal",
          breadcrumb: [
            { name: "Home", path: "/" },
            { name: "Services", path: "/services" },
            {
              name: "Journal & Free Resources — Brighter Tomorrow Therapy",
              path: "/services/journal",
            },
          ],
        })}
      />
      <article className="bg-white">
      {/* HERO */}
      <section className="relative overflow-hidden">
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{
            backgroundImage:
              "linear-gradient(rgba(15,22,30,0.55), rgba(15,22,30,0.68)), url('/images/services/journal/hero-bg.jpg')",
          }}
          aria-hidden
        />
        <div className="relative container-x py-28 sm:py-36 lg:py-44 text-center">
          <Reveal>
            <h1 className="font-display font-bold leading-tight text-[40px] sm:text-[52px] lg:text-[60px] break-words" style={{ color: "#F4F4F4" }}>
              <span style={{ color: GOLD }}>Journal</span> &amp; Free Resources
            </h1>
          </Reveal>
        </div>
      </section>

      {/* SECTION 2 — Tame My Chronic Pain feature */}
      <section className="bg-white">
        <div className="container-x py-20 lg:py-28">
          <div className="grid lg:grid-cols-12 gap-12 lg:gap-16 items-center">
            <Reveal className="lg:col-span-7">
              <h2 className="font-display font-bold leading-[1.15] text-[32px] sm:text-[40px] lg:text-[45px]" style={{ color: INK }}>
                Tame My Chronic Pain.
              </h2>
              <p className="mt-6 font-display font-semibold text-[18px] sm:text-[20px] leading-[1.65]" style={{ color: WINE }}>
                An interactive journal to manage your pain and live your life
                with chronic pain.
              </p>
              <p className="mt-5 text-[15px] sm:text-[16px] leading-[1.75] text-ink-soft">
                Created by the team at Brighter Tomorrow Therapy, this journal
                pairs daily tracking with reflective prompts to help you
                understand your pain patterns, name what triggers them, and
                build a toolkit that travels with you.
              </p>
              <div className="mt-8 flex flex-wrap gap-4">
                <a
                  href="https://www.amazon.com/Tame-My-Chronic-Pain-interactive/dp/B0BMSY623W/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 font-display font-bold tracking-[0.15em] text-[13px] uppercase px-8 py-4 transition hover:opacity-90"
                  style={{ backgroundColor: GOLD, color: INK, borderRadius: "30px 0 30px 30px" }}
                >
                  <FiBookOpen size={16} />
                  Purchase the Journal
                </a>
                <Link
                  href="https://brightertomorrow.janeapp.com/" target="_blank" rel="noopener noreferrer"
                  className="inline-block font-display font-bold tracking-[0.15em] text-[13px] uppercase px-8 py-4 transition hover:opacity-90 border-2"
                  style={{ borderColor: WINE, color: WINE, borderRadius: "30px 0 30px 30px" }}
                >
                  Get Scheduled
                </Link>
              </div>
            </Reveal>

            <Reveal delay={0.1} className="lg:col-span-5">
              <div className="relative mx-auto max-w-[460px]">
                <div className="absolute -bottom-6 -right-6 w-full h-full" style={{ backgroundColor: WINE, borderRadius: "60px 0 60px 60px" }} aria-hidden />
                <div className="relative aspect-[4/5] overflow-hidden transition-transform duration-500 hover:scale-[1.02]" style={{ borderRadius: "60px 0 60px 60px" }}>
                  <Image src="/images/services/journal/book-cover.jpg" alt="Tame My Chronic Pain journal cover" fill priority sizes="(min-width:1024px) 420px, 100vw" className="object-cover" />
                </div>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* SECTION 3 — Free Resources grid (cards on cream sandwich) */}
      <section style={{ backgroundColor: WINE }} className="relative">
        <div className="bg-cream pt-16 pb-20 px-4 sm:px-6 lg:px-10 mx-3 sm:mx-6 lg:mx-12 rounded-[40px] -my-10 relative z-10">
          <Reveal>
            <h3 className="text-center font-display font-bold text-[28px] sm:text-[34px] lg:text-[37.5px]" style={{ color: INK }}>
              Free Downloadable Workbooks
            </h3>
            <p className="mt-4 text-center mx-auto max-w-[640px] text-[15px] leading-[1.7] text-ink-soft">
              Practical, therapist-built workbooks you can download today —
              free, no signup required.
            </p>
          </Reveal>

          <WorkbookGrid items={workbooks} />
        </div>
      </section>

      {/* CTA */}
      <section className="relative overflow-hidden" style={{ backgroundColor: "#6E7A8A" }}>
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{
            backgroundImage:
              "linear-gradient(rgba(15,22,30,0.62), rgba(15,22,30,0.62)), url('/images/services/cta-bg.webp')",
          }}
          aria-hidden
        />
        <div className="container-x py-20 lg:py-24 text-center relative z-10">
          <Reveal>
            <p className="font-script italic text-[20px] sm:text-[24px]" style={{ color: GOLD }}>
              Ready for the next step?
            </p>
            <h3 className="mt-3 font-display font-bold text-[32px] sm:text-[40px] lg:text-[45px] text-white leading-[1.15]">
              Pair these tools with a{" "}
              <span style={{ color: GOLD }}>licensed therapist</span>.
            </h3>
            <div className="mt-8">
              <Link
                href="/contact"
                className="inline-block font-display font-bold tracking-[0.15em] text-[13px] uppercase px-8 py-4 transition hover:opacity-90"
                style={{ backgroundColor: GOLD, color: INK, borderRadius: "30px 0 30px 30px" }}
              >
                Book a Consultation
              </Link>
            </div>
          </Reveal>
        </div>
      </section>
      </article>
    </>
  );
}
