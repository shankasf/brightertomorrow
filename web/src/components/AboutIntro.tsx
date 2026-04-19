import Link from "next/link";
import Reveal from "./Reveal";
import { FiArrowRight, FiAward, FiHeart } from "react-icons/fi";

export default function AboutIntro() {
  return (
    <section className="section">
      <div className="container-x grid lg:grid-cols-12 gap-10 items-start">
        <Reveal className="lg:col-span-7">
          <span className="text-xs uppercase tracking-[0.2em] text-brand font-semibold">About Brighter Tomorrow Therapy</span>
          <h2 className="mt-2 text-3xl md:text-4xl font-bold text-ink">You Are Ready. The Right Therapist Is Here.</h2>
          <p className="mt-5 text-ink-muted leading-relaxed">
            Brighter Tomorrow Therapy Collective is built on a simple belief: the right therapist
            changes everything. Our clinicians are trained specialists who have each chosen the
            populations and challenges they are best equipped to serve — trauma, grief, anxiety,
            relationships, and more.
          </p>
          <p className="mt-4 text-ink-muted leading-relaxed">
            We are rooted in Las Vegas and North Las Vegas, and we serve clients across all of
            Nevada through telehealth.
          </p>
          <Link href="/about" className="btn-ghost mt-6 inline-flex">
            Learn more about us <FiArrowRight />
          </Link>
        </Reveal>

        <Reveal delay={0.1} className="lg:col-span-5">
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="bg-white rounded-2xl border border-surface-line p-6 shadow-soft">
              <div className="w-11 h-11 rounded-full bg-brand-50 text-brand grid place-items-center mb-4">
                <FiAward size={20} />
              </div>
              <h4 className="font-display font-semibold text-ink">Licensed Specialists Across 7 Focus Areas</h4>
              <p className="text-sm text-ink-muted mt-2">
                Clinicians matched to your needs — not generalists.
              </p>
            </div>
            <div className="bg-white rounded-2xl border border-surface-line p-6 shadow-soft">
              <div className="w-11 h-11 rounded-full bg-brand-50 text-brand grid place-items-center mb-4">
                <FiHeart size={20} />
              </div>
              <h4 className="font-display font-semibold text-ink">Holistic Approach</h4>
              <p className="text-sm text-ink-muted mt-2">
                Personalized care that addresses your specific needs, so you feel understood,
                supported, and empowered.
              </p>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
