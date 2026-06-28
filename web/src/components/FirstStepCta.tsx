import Link from "next/link";
import Reveal from "./Reveal";

/**
 * Gray "The First Step Is Choosing to Take It." CTA band.
 * Mirrors live brightertomorrowtherapy.com — sits between testimonials and FAQ.
 */
export default function FirstStepCta() {
  return (
    <section
      className="section relative overflow-hidden"
      style={{ backgroundColor: "#5a6878" }}
    >
      <div className="container-x">
        <Reveal>
          <div className="max-w-3xl mx-auto text-center">
            <h2 className="display text-4xl sm:text-5xl md:text-6xl text-white leading-[1.08]">
              The First Step Is{" "}
              <span className="italic-accent" style={{ color: "#E1B878" }}>
                Choosing to Take It.
              </span>
            </h2>
            <p
              className="mt-6 text-base sm:text-lg leading-relaxed"
              style={{ color: "rgba(255,255,255,0.88)" }}
            >
              You have already done something important by being here. The
              clinicians at Brighter Tomorrow Therapy Collective are ready to
              meet you where you are &mdash; in person in Las Vegas or North
              Las Vegas, or virtually anywhere in Nevada.
            </p>
            <div className="mt-9 flex flex-wrap items-center justify-center gap-4">
              <a
                href="/get-scheduled"
                className="btn-primary"
              >
                Find My Therapist
              </a>
              <Link
                href="/contact"
                className="inline-flex items-center gap-2 text-white border border-white/40 hover:bg-white hover:text-ink px-6 py-4 font-semibold uppercase tracking-[0.12em] text-[0.82rem] transition"
                style={{ borderRadius: "20px 0 20px 20px" }}
              >
                Book an Appointment
              </Link>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
