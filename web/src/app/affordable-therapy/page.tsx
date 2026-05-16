import Link from "next/link";
import Reveal from "@/components/Reveal";
import { FiArrowUpRight, FiPhone, FiCheck, FiAlertCircle, FiInfo } from "react-icons/fi";

export const metadata = {
  title: "Affordable Therapy in Las Vegas — Brighter Tomorrow Therapy",
  description:
    "Pay-what-you-can therapy in Las Vegas, NV. 50-minute sessions from $25, in-person or virtual statewide, provided by supervised Master's-level graduate students.",
};

const PACKAGES = [
  { label: "Single session", price: "$25 – $60", sub: "Pay what you can" },
  { label: "5-session package", price: "$150", sub: "Valid 6 months" },
  { label: "10-session package", price: "$250", sub: "Valid 6 months" },
];

const ELIGIBILITY = [
  "Do not have insurance",
  "Cannot afford the full out-of-pocket cost",
  "Have a family without insurance and cannot afford private-pay rates",
  "Are waiting on insurance to be eligible for services",
];

export default function AffordableTherapyPage() {
  return (
    <>
      {/* Hero */}
      <section className="bg-cream-alt relative overflow-hidden">
        <div aria-hidden className="absolute inset-0 bg-grid opacity-[0.06]" />
        <div className="container-narrow relative py-20 sm:py-28 lg:py-32 text-center">
          <span className="eyebrow center">Affordable Therapy</span>
          <h1 className="mt-6 display text-5xl sm:text-6xl lg:text-7xl text-ink">
            Affordable therapy in <span className="italic-accent">Las Vegas, NV.</span>
          </h1>
          <svg aria-hidden viewBox="0 0 200 8" className="mx-auto mt-7 w-36 h-2 text-brand">
            <path d="M2 5 Q 50 0 100 4 T 198 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <p className="mt-7 text-ink text-xl sm:text-2xl font-display leading-snug max-w-2xl mx-auto">
            We offer <span className="italic-accent">low-cost</span> therapy in Las Vegas, NV.
          </p>
          <p className="mt-5 text-ink-muted text-base sm:text-lg leading-relaxed max-w-2xl mx-auto">
            Many people are often unable to obtain mental health services due to lack of insurance and high out-of-pocket cost.
          </p>
        </div>
      </section>

      {/* Pay-what-you-can pricing block */}
      <section className="section bg-white">
        <div className="container-x">
          <Reveal>
            <div className="max-w-2xl">
              <span className="eyebrow">Pay-what-you-can</span>
              <h2 className="mt-5 display text-4xl sm:text-5xl text-ink leading-[1.05]">
                Sessions from <span className="italic-accent">$25.</span>
              </h2>
              <p className="mt-5 text-ink-muted leading-relaxed">
                Full-length, 50-minute sessions available in-person or virtually statewide.
              </p>
            </div>
          </Reveal>

          <div className="mt-12 grid md:grid-cols-3 gap-6 lg:gap-8">
            {PACKAGES.map((p, i) => (
              <Reveal key={p.label} delay={i * 0.05}>
                <article
                  className={`h-full rounded-4xl border p-8 lg:p-10 shadow-soft ${
                    i === 0
                      ? "bg-cream-deep border-brand-300 shadow-card"
                      : "bg-cream border-surface-line"
                  }`}
                >
                  <div className="font-display text-lg text-ink">{p.label}</div>
                  <div className="mt-4 pt-4 border-t border-surface-line">
                    <div className="display text-5xl sm:text-6xl text-brand-700 tabular">
                      {p.price}
                    </div>
                    <div className="text-sm text-ink-muted mt-2">{p.sub}</div>
                  </div>
                </article>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Program Overview */}
      <section className="section bg-cream-alt">
        <div className="container-x grid lg:grid-cols-12 gap-10 lg:gap-16 items-start">
          <Reveal className="lg:col-span-5">
            <span className="eyebrow">Program Overview</span>
            <h2 className="mt-5 display text-4xl sm:text-5xl text-ink leading-[1.05]">
              How it <span className="italic-accent">works.</span>
            </h2>
          </Reveal>
          <Reveal delay={0.05} className="lg:col-span-7">
            <p className="text-ink-muted text-lg leading-relaxed">
              Through our counseling internship student program, we are able to make this a reality and offer low cost therapy sessions.
              Sessions are provided by Master&apos;s-level graduate students under licensed supervision.
            </p>
          </Reveal>
        </div>
      </section>

      {/* Eligibility */}
      <section className="section bg-white">
        <div className="container-x">
          <Reveal>
            <div className="max-w-2xl">
              <span className="eyebrow">Eligibility</span>
              <h2 className="mt-5 display text-4xl sm:text-5xl text-ink leading-[1.05]">
                You may <span className="italic-accent">qualify if you:</span>
              </h2>
            </div>
          </Reveal>

          <ul className="mt-10 grid sm:grid-cols-2 gap-5 lg:gap-6">
            {ELIGIBILITY.map((item, i) => (
              <Reveal key={item} delay={i * 0.04}>
                <li className="h-full flex items-start gap-4 bg-cream rounded-3xl border border-surface-line p-6 shadow-soft">
                  <span className="mt-0.5 shrink-0 w-8 h-8 rounded-full bg-sage-100 text-sage-700 grid place-items-center">
                    <FiCheck size={14} />
                  </span>
                  <span className="text-ink leading-relaxed">{item}</span>
                </li>
              </Reveal>
            ))}
          </ul>
        </div>
      </section>

      {/* Practicum Student note */}
      <section className="section-tight bg-cream">
        <div className="container-narrow">
          <Reveal>
            <div className="rounded-4xl bg-white border border-surface-line p-7 sm:p-9 shadow-soft flex gap-5">
              <span className="shrink-0 w-11 h-11 rounded-full bg-brand/15 text-brand-700 grid place-items-center">
                <FiInfo />
              </span>
              <div>
                <h3 className="font-display text-xl text-ink leading-snug">
                  About our practicum students
                </h3>
                <p className="mt-3 text-ink-muted leading-relaxed">
                  Practicum students are still in training and completing their graduate education. Availability is limited to their
                  practicum period, which typically lasts 3–4 months.
                </p>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* Cancellation Policy */}
      <section className="section-tight bg-cream">
        <div className="container-narrow pb-16">
          <Reveal>
            <div className="rounded-4xl bg-white border border-surface-line p-7 sm:p-9 shadow-soft flex gap-5">
              <span className="shrink-0 w-11 h-11 rounded-full bg-brand/15 text-brand-700 grid place-items-center">
                <FiAlertCircle />
              </span>
              <div>
                <h3 className="font-display text-xl text-ink leading-snug">
                  Cancellation policy
                </h3>
                <p className="mt-3 text-ink-muted leading-relaxed">
                  A $50 fee will be charged for any missed sessions, including within the initial two free sessions. To cancel, call{" "}
                  <a href="tel:725-238-6990" className="text-brand-700 underline decoration-brand-700/30 hover:decoration-brand-700">
                    725-238-6990
                  </a>{" "}
                  at least 24 hours in advance.
                </p>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* Closing CTA */}
      <section className="bg-ink text-white">
        <div className="container-x py-16 sm:py-20 text-center">
          <span className="eyebrow center" style={{ color: "var(--brand)" }}>
            Get started
          </span>
          <h2 className="mt-5 display text-4xl sm:text-5xl text-white leading-[1.05]">
            Ready to <span className="italic-accent">begin?</span>
          </h2>
          <p className="mt-5 text-white/80 leading-relaxed max-w-xl mx-auto">
            Call us directly or let us match you with the right student therapist for your needs.
          </p>
          <div className="mt-9 flex flex-wrap justify-center gap-4">
            <a href="tel:725-238-6990" className="btn-primary">
              <FiPhone /> 725-238-6990
            </a>
            <Link href="/contact" className="btn-ghost" style={{ color: "#F4F4F4", borderColor: "var(--brand)" }}>
              Get matched <FiArrowUpRight />
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
