import Link from "next/link";
import Reveal from "@/components/Reveal";
import { getSiteSettings, getStats } from "@/lib/queries";
import { FiCheck, FiArrowUpRight } from "react-icons/fi";

export const metadata = { title: "Our Story — Brighter Tomorrow Therapy" };

const VALUES = [
  {
    title: "Fit first.",
    body: "We believe the right therapist changes everything — so we match every client with a clinician who actually fits.",
  },
  {
    title: "Evidence-based & warm.",
    body: "Modalities backed by research, delivered by humans who lead with empathy and lived skill.",
  },
  {
    title: "Identity-affirming.",
    body: "Care that honors who you are — your culture, your relationships, your full self.",
  },
];

export default async function OurStoryPage() {
  const [settings, stats] = await Promise.all([getSiteSettings(), getStats()]);

  return (
    <>
      {/* Page header */}
      <section className="bg-cream-alt relative overflow-hidden">
        <div aria-hidden className="absolute inset-0 bg-grid opacity-[0.06]" />
        <div className="container-narrow relative py-20 sm:py-28 lg:py-32 text-center">
          <span className="eyebrow center">Our Story</span>
          <h1 className="mt-6 display text-5xl sm:text-6xl lg:text-7xl text-ink">
            A Vegas collective, built around{" "}
            <span className="italic-accent">fit.</span>
          </h1>
          <svg
            aria-hidden
            viewBox="0 0 200 8"
            className="mx-auto mt-7 w-36 h-2 text-brand"
          >
            <path
              d="M2 5 Q 50 0 100 4 T 198 5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
          <p className="mt-7 text-ink-muted text-lg sm:text-xl leading-relaxed max-w-2xl mx-auto">
            {settings.tagline}
          </p>
        </div>
      </section>

      {/* Founder story — editorial split */}
      <section className="section bg-white">
        <div className="container-x grid lg:grid-cols-2 gap-12 lg:gap-20 items-center">
          {settings.hero_image_url && (
            <Reveal>
              <div className="relative">
                <div
                  className="absolute -inset-4 bg-cream-alt rounded-4xl -rotate-1"
                  aria-hidden
                />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={settings.hero_image_url}
                  alt=""
                  className="relative rounded-4xl shadow-card w-full aspect-[5/4] object-cover"
                />
              </div>
            </Reveal>
          )}
          <Reveal delay={0.1}>
            <div>
              <span className="eyebrow">Founded in Las Vegas</span>
              <h2 className="mt-5 display text-4xl sm:text-5xl text-ink">
                Yvette Howard built a place where{" "}
                <span className="italic-accent">everyone fits.</span>
              </h2>
              <p className="mt-6 text-ink-muted text-lg leading-[1.75]">
                Yvette Howard founded Brighter Tomorrow Therapy Collective to
                make accessible, identity-affirming mental health care available
                to every Nevadan — from Summerlin to North Las Vegas to the
                farthest corners of the state.
              </p>
              <p className="mt-5 text-ink-muted text-lg leading-[1.75]">
                What started as a single clinician&apos;s commitment to better
                care has grown into a collective of trained specialists who
                share one belief: the right therapist changes everything.
                We see clients in person and via secure telehealth across
                Nevada, so geography is never the thing standing between you
                and the support you deserve.
              </p>
              <p className="mt-6 script text-2xl text-brand-700">
                — Yvette Howard, Founder
              </p>
            </div>
          </Reveal>
        </div>
      </section>

      {/* Mission statement */}
      <section className="section bg-white pt-0 sm:pt-0">
        <div className="container-narrow">
          <Reveal>
            <div className="rounded-4xl bg-cream-alt border border-surface-line p-10 sm:p-14 lg:p-16 text-center shadow-soft">
              <span className="eyebrow center">Our Mission</span>
              <p className="mt-6 font-display text-2xl sm:text-3xl lg:text-4xl text-ink leading-[1.25] tracking-tight">
                To make therapy and counseling{" "}
                <span className="italic-accent">accessible to everyone,</span>{" "}
                regardless of age or background.
              </p>
              <p className="mt-7 text-ink-muted text-lg leading-relaxed max-w-xl mx-auto">
                We believe that everyone deserves a brighter future, and our
                name encapsulates our commitment to guiding you toward a
                brighter tomorrow.
              </p>
            </div>
          </Reveal>
        </div>
      </section>

      {/* Values — 3-column */}
      <section className="section bg-cream">
        <div className="container-x">
          <Reveal>
            <div className="text-center max-w-2xl mx-auto mb-14">
              <span className="eyebrow center">Our values</span>
              <h2 className="mt-5 display text-4xl sm:text-5xl text-ink">
                What we <span className="italic-accent">stand for.</span>
              </h2>
            </div>
          </Reveal>
          <div className="grid md:grid-cols-3 gap-6 lg:gap-8">
            {VALUES.map((v, i) => (
              <Reveal key={v.title} delay={i * 0.06}>
                <div className="h-full bg-white rounded-3xl border border-surface-line p-8 lg:p-10 shadow-soft hover:shadow-card transition-all duration-500">
                  <span className="inline-flex w-11 h-11 items-center justify-center rounded-full bg-sage-100 text-sage-700">
                    <FiCheck size={20} />
                  </span>
                  <h3 className="mt-6 font-display text-2xl text-ink leading-tight">
                    {v.title}
                  </h3>
                  <p className="mt-4 text-ink-muted leading-relaxed">{v.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Stats strip — brand wine */}
      <section className="bg-brand-700 text-white">
        <div className="container-x grid grid-cols-2 md:grid-cols-4 gap-4 sm:gap-5 lg:gap-6 py-14 lg:py-16 text-center">
          {stats.map((s) => (
            <div key={s.id}>
              <div className="text-white/80 text-xs sm:text-sm uppercase tracking-wider">
                {s.label}
              </div>
              <div className="text-3xl sm:text-4xl md:text-5xl font-display font-bold mt-1 text-brand">
                {s.value}
                {s.suffix}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="section bg-cream-alt">
        <div className="container-narrow">
          <Reveal>
            <div className="rounded-4xl bg-cream-deep border border-surface-line p-10 sm:p-14 lg:p-16 text-center shadow-soft">
              <span className="eyebrow center">Ready when you are</span>
              <h2 className="mt-5 display text-4xl sm:text-5xl text-ink">
                Let&apos;s find your{" "}
                <span className="italic-accent">right fit.</span>
              </h2>
              <p className="mt-5 text-ink-muted text-lg max-w-md mx-auto">
                Tell us a little about what you&apos;re looking for. We&apos;ll
                respond within one business day.
              </p>
              <div className="mt-8 flex flex-wrap justify-center gap-3">
                <Link href="/contact" className="btn-primary">
                  Get matched <FiArrowUpRight />
                </Link>
                <Link href="/team" className="btn-ghost">
                  Meet the team
                </Link>
              </div>
            </div>
          </Reveal>
        </div>
      </section>
    </>
  );
}
