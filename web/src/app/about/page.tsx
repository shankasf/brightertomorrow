import Reveal from "@/components/Reveal";
import { getSiteSettings, getStats } from "@/lib/queries";

export const metadata = { title: "About — Brighter Tomorrow Therapy" };

export default async function AboutPage() {
  const [settings, stats] = await Promise.all([getSiteSettings(), getStats()]);
  return (
    <>
      <section className="bg-hero-gradient">
        <div className="container-x py-10 sm:py-14 lg:py-16 grid lg:grid-cols-2 gap-8 sm:gap-10 items-center">
          <div>
            <span className="text-xs uppercase tracking-[0.2em] text-brand font-semibold">About Us</span>
            <h1 className="mt-2 text-3xl sm:text-4xl md:text-5xl font-bold text-ink">A collective built around fit.</h1>
            <p className="mt-4 text-ink-muted text-base sm:text-lg">
              {settings.tagline} We believe the right therapist changes everything — so we built a
              team of trained specialists with depth, warmth, and the lived skill to meet you
              where you are.
            </p>
          </div>
          {settings.hero_image_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={settings.hero_image_url} alt="" className="rounded-3xl shadow-card w-full aspect-[5/4] object-cover" />
          )}
        </div>
      </section>

      <section className="section !py-10 sm:!py-14 lg:!py-20">
        <div className="container-x grid md:grid-cols-2 gap-8 md:gap-12">
          <Reveal>
            <h2 className="font-display text-2xl sm:text-3xl font-bold text-ink">Our Story</h2>
            <p className="mt-3 text-ink-muted leading-relaxed">
              Brighter Tomorrow Therapy Collective was founded to make excellent, accessible
              mental health care possible across Las Vegas, North Las Vegas, and all of Nevada
              via secure telehealth.
            </p>
          </Reveal>
          <Reveal delay={0.1}>
            <h2 className="font-display text-2xl sm:text-3xl font-bold text-ink">Our Approach</h2>
            <p className="mt-3 text-ink-muted leading-relaxed">
              Evidence-based, identity-affirming, and tailored to you. We match every client with a
              clinician who actually fits — and adjust as your needs evolve.
            </p>
          </Reveal>
        </div>
      </section>

      <section className="bg-brand text-white">
        <div className="container-x grid grid-cols-2 md:grid-cols-4 gap-4 sm:gap-5 lg:gap-6 py-10 sm:py-12 lg:py-14 text-center">
          {stats.map((s) => (
            <div key={s.id}>
              <div className="text-white/80 text-xs sm:text-sm uppercase tracking-wider">{s.label}</div>
              <div className="text-3xl sm:text-4xl md:text-5xl font-display font-bold mt-1">
                {s.value}{s.suffix}
              </div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
