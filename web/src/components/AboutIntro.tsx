import Link from "next/link";
import Reveal from "./Reveal";
import { FiArrowRight } from "react-icons/fi";

export default function AboutIntro() {
  return (
    <section className="section">
      <div className="container-x grid lg:grid-cols-12 gap-12 lg:gap-16 items-start">
        {/* LEFT — narrative */}
        <Reveal className="lg:col-span-7">
          <span className="eyebrow text-brand-700">About Brighter Tomorrow Therapy</span>

          <h2 className="mt-5 display text-4xl md:text-5xl lg:text-[3.75rem] text-ink leading-[1.04]">
            You Are Ready.
            <br />
            <span className="italic-accent">The Right Therapist Is Here.</span>
          </h2>

          <p className="mt-7 text-ink-muted text-lg leading-relaxed max-w-xl">
            Brighter Tomorrow Therapy Collective is built on a simple belief: the right therapist
            changes everything. Our clinicians are trained specialists who have each chosen the
            populations and challenges they are best equipped to serve — trauma, grief, anxiety,
            relationships, and more.
          </p>

          <p className="mt-5 text-ink-muted text-lg leading-relaxed max-w-xl">
            We are rooted in Las Vegas and North Las Vegas, and we serve clients across all of
            Nevada through telehealth.
          </p>

          <Link
            href="/our-story"
            className="mt-8 inline-flex items-center gap-2 text-brand-700 hover:text-brand font-semibold border-b border-brand-300 hover:border-brand pb-1 transition-colors"
          >
            Read our story <FiArrowRight />
          </Link>
        </Reveal>

        {/* RIGHT — editorial stat panel */}
        <Reveal delay={0.1} className="lg:col-span-5">
          <div className="relative">
            {/* Decorative wavy ornament */}
            <svg
              aria-hidden
              viewBox="0 0 120 12"
              className="w-24 h-3 mb-6 text-brand"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <path d="M2 6 Q 18 0, 34 6 T 66 6 T 98 6 T 118 6" />
            </svg>

            <div className="bg-cream rounded-4xl border border-surface-line shadow-soft overflow-hidden">
              <div className="px-6 py-8 sm:px-10 sm:py-11">
                <div className="text-[clamp(3.5rem,16vw,6rem)] leading-none font-display text-brand-700 tabular">
                  7
                </div>
                <div className="mt-3 font-display text-xl text-ink">Focus areas</div>
                <p className="mt-3 text-sm text-ink-muted leading-relaxed">
                  Licensed Specialists Across 7 Focus Areas — clinicians matched to your needs,
                  not generalists.
                </p>
              </div>

              <div className="border-t border-surface-line/80" />

              <div className="px-6 py-8 sm:px-10 sm:py-11">
                <div className="text-[clamp(3.5rem,16vw,6rem)] leading-none font-display text-brand-700 tabular">
                  100<span className="text-brand-400">%</span>
                </div>
                <div className="mt-3 font-display text-xl text-ink">Holistic care</div>
                <p className="mt-3 text-sm text-ink-muted leading-relaxed">
                  Personalized care that addresses your specific needs, so you feel understood,
                  supported, and empowered.
                </p>
              </div>
            </div>

            {/* Tiny script caption under the panel */}
            <p className="script mt-5 text-ink-soft text-sm">
              A collective rooted in care.
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
