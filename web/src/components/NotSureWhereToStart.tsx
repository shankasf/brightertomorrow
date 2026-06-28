import { FiArrowRight } from "react-icons/fi";
import Reveal from "./Reveal";

// In-house therapist-match flow (replaced the JotForm questionnaire).
const MATCH_URL = "/get-scheduled";

export default function NotSureWhereToStart() {
  return (
    <section className="section bg-cream-alt relative overflow-hidden border-y border-surface-line">
      {/* soft gold corner accent */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 -right-24 w-[420px] h-[420px] rounded-full opacity-[0.10]"
        style={{ backgroundColor: "#E1B878" }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-32 -left-32 w-[420px] h-[420px] rounded-full opacity-[0.08]"
        style={{ backgroundColor: "#66202A" }}
      />

      <div className="container-narrow relative">
        <Reveal>
          <div className="text-center">
            <span
              className="eyebrow center"
              style={{ color: "#E1B878" }}
            >
              Therapist Matching
            </span>
            <h2 className="mt-5 display text-4xl sm:text-5xl md:text-6xl text-ink leading-[1.05]">
              Not Sure{" "}
              <span className="italic-accent" style={{ color: "#66202A" }}>
                Where to Start?
              </span>
            </h2>
            <p className="mt-6 text-base sm:text-lg text-ink-muted leading-relaxed max-w-2xl mx-auto">
              Finding the right therapist is the most important part of the
              process. Our quick matching tool walks you through a few simple
              questions about what you are looking for and connects you with
              the clinician in our collective who is the best fit for your
              needs, your schedule, and your location. It takes less than two
              minutes.
            </p>

            <div className="mt-9 flex flex-wrap items-center justify-center gap-4">
              <a
                href={MATCH_URL}
                className="btn-primary"
              >
                Find My Therapist <FiArrowRight size={14} />
              </a>
            </div>

            <p className="mt-5 text-xs uppercase tracking-[0.18em] font-semibold text-ink-soft">
              Less than 2 minutes &middot; No credit card &middot; HIPAA-secure
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
