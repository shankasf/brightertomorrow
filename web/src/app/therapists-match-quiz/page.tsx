import Reveal from "@/components/Reveal";
import { FiArrowUpRight } from "react-icons/fi";

export const metadata = {
  title: "Therapists Match Quiz — Brighter Tomorrow Therapy",
  description:
    "Answer a few quick questions and we'll match you with the right therapist from the Brighter Tomorrow Therapy team based on your needs and preferences.",
};

const JOTFORM_MATCH_URL = "https://form.jotform.com/253014448330448";

export default function TherapistsMatchQuizPage() {
  return (
    <>
      <section className="bg-cream-alt relative overflow-hidden">
        <div aria-hidden className="absolute inset-0 bg-grid opacity-[0.06]" />
        <div className="container-narrow relative py-20 sm:py-28 text-center">
          <Reveal>
            <span className="eyebrow center">Find your therapist here</span>
            <h1 className="mt-6 display text-4xl sm:text-5xl md:text-6xl text-ink">
              Therapists <span className="italic-accent">Match Quiz</span>
            </h1>
            <svg aria-hidden viewBox="0 0 200 8" className="mx-auto mt-7 w-36 h-2 text-brand">
              <path d="M2 5 Q 50 0 100 4 T 198 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <p className="mt-7 text-ink-muted text-lg sm:text-xl leading-relaxed max-w-2xl mx-auto">
              Answer a few quick questions and we&apos;ll match you with the provider best suited to
              your needs and preferences. The questionnaire below is powered by JotForm.
            </p>
            <a
              href={JOTFORM_MATCH_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-primary mt-8 inline-flex"
            >
              Start the quiz <FiArrowUpRight />
            </a>
          </Reveal>
        </div>
      </section>

      <section className="section bg-white">
        <div className="container-narrow">
          <Reveal>
            <div className="rounded-4xl overflow-hidden border border-surface-line shadow-card bg-cream">
              <iframe
                title="Therapist Match Questionnaire"
                src={JOTFORM_MATCH_URL}
                className="w-full"
                style={{ height: "min(85vh, 1100px)", border: "0" }}
                allow="geolocation; microphone; camera; fullscreen"
              />
            </div>
          </Reveal>
        </div>
      </section>
    </>
  );
}
