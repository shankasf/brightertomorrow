import Link from "next/link";
import Reveal from "./Reveal";
import { FiArrowRight, FiArrowUpRight } from "react-icons/fi";

const CARDS: { title: string; blurb: string; href: string }[] = [
  { title: "Individual Therapy",
    blurb: "One-on-one sessions focused entirely on you — anxiety, depression, trauma, life transitions, and more.",
    href: "/services/individual-therapy" },
  { title: "Child and Teen Therapy",
    blurb: "Therapists who understand that young people need a different kind of space. Serving kids and teens across Nevada.",
    href: "/specialties/child" },
  { title: "Couples Counseling",
    blurb: "Rebuild trust, improve communication, and move through major transitions together.",
    href: "/specialties/couples" },
  { title: "LGBTQIA+ Affirming Therapy",
    blurb: "Every clinician works with LGBTQIA+ clients with full affirmation — not just tolerance.",
    href: "/specialties/lgbtqia" },
  { title: "Trauma and PTSD Therapy",
    blurb: "Evidence-based approaches to help you process what happened and move forward with your life.",
    href: "/specialties/trauma-ptsd" },
  { title: "Anxiety and Depression Therapy",
    blurb: "Specialists trained to help you get traction when anxiety keeps you stuck or depression flattens everything.",
    href: "/specialties/anxiety" },
  { title: "Grief Counseling",
    blurb: "Support to process loss, manage difficult emotions, and find a path forward at your pace.",
    href: "/specialties/grief" },
  { title: "Geriatric Counseling",
    blurb: "Care for older adults navigating grief, health transitions, isolation, and the emotional terrain of aging.",
    href: "/specialties/geriatric" },
];

export default function HowWeHelp() {
  return (
    <section className="section bg-cream-gradient relative overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-0 opacity-60"
        style={{
          backgroundImage:
            "radial-gradient(900px 480px at 8% 0%, rgba(225,184,120,0.10), transparent 60%), radial-gradient(800px 480px at 92% 100%, rgba(117,172,192,0.10), transparent 60%)",
        }}
      />
      <div className="container-x relative">
        <Reveal>
          <div className="text-center max-w-2xl mx-auto mb-14">
            <span className="eyebrow center justify-center text-brand-700">How We Help</span>
            <h2 className="mt-5 display text-3xl md:text-5xl lg:text-[3.5rem] text-ink leading-[1.05]">
              How Our Therapists in <span className="italic-accent">Las Vegas</span> and North Las Vegas, NV, Can Help
            </h2>
          </div>
        </Reveal>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5 sm:gap-6">
          {CARDS.map((c, i) => (
            <Reveal key={c.title} delay={i * 0.04}>
              <Link
                href={c.href}
                className="group flex flex-col h-full bg-cream rounded-3xl border border-surface-line p-7 hover:border-brand hover:shadow-card hover:-translate-y-1 transition-all duration-300"
              >
                <div className="flex items-center justify-between text-brand-300 mb-5">
                  <span className="eyebrow-bare text-[0.7rem] tabular text-brand-400">
                    {String(i + 1).padStart(2, "0")} — {String(CARDS.length).padStart(2, "0")}
                  </span>
                  <FiArrowUpRight
                    className="w-4 h-4 text-brand-300 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-300"
                  />
                </div>

                <h4 className="font-display text-xl text-ink leading-tight group-hover:text-brand-700 transition-colors">
                  {c.title}
                </h4>

                <p className="text-sm text-ink-muted mt-3 leading-relaxed flex-1">
                  {c.blurb}
                </p>

                <span className="text-sm text-brand-700 mt-6 inline-flex items-center gap-1.5 font-semibold">
                  Learn more
                  <FiArrowRight className="group-hover:translate-x-1 transition-transform" />
                </span>
              </Link>
            </Reveal>
          ))}
        </div>

        {/* Bottom CTA — prominent cream-alt cell */}
        <Reveal delay={0.2}>
          <div className="mt-16 rounded-4xl bg-cream-alt border border-surface-line px-8 py-10 sm:px-12 sm:py-12 text-center sm:text-left sm:flex sm:items-center sm:justify-between gap-8 shadow-soft">
            <div>
              <span className="script text-brand-700 text-lg">A gentle next step</span>
              <h3 className="font-display text-2xl sm:text-3xl text-ink mt-1">
                Not Sure Where to Start?
              </h3>
              <p className="text-ink-muted mt-2 max-w-lg mx-auto sm:mx-0">
                Tell us a little about what you&rsquo;re looking for and we&rsquo;ll match you with the right therapist.
              </p>
            </div>
            <a
              href="https://form.jotform.com/253014448330448"
              target="_blank"
              rel="noopener noreferrer"
              className="btn-primary mt-6 sm:mt-0 shrink-0"
            >
              Find My Therapist <FiArrowRight />
            </a>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
