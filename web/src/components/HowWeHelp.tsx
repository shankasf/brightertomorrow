import Link from "next/link";
import Reveal from "./Reveal";
import { FiArrowRight } from "react-icons/fi";

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
    <section className="section bg-surface-alt">
      <div className="container-x">
        <Reveal>
          <div className="text-center max-w-2xl mx-auto mb-12">
            <span className="text-xs uppercase tracking-[0.2em] text-brand font-semibold">How We Help</span>
            <h2 className="mt-2 text-3xl md:text-4xl font-bold text-ink">
              How Our Therapists in Las Vegas and North Las Vegas, NV, Can Help
            </h2>
          </div>
        </Reveal>
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-5">
          {CARDS.map((c, i) => (
            <Reveal key={c.title} delay={i * 0.04}>
              <Link href={c.href}
                    className="group flex flex-col h-full bg-white rounded-2xl border border-surface-line p-6 hover:border-brand hover:shadow-soft hover:-translate-y-1 transition-all duration-300">
                <h4 className="font-display text-lg font-semibold text-ink group-hover:text-brand transition">
                  {c.title}
                </h4>
                <p className="text-sm text-ink-muted mt-3 flex-1">{c.blurb}</p>
                <span className="text-sm text-brand mt-4 inline-flex items-center gap-1 font-semibold">
                  Learn more <FiArrowRight className="group-hover:translate-x-1 transition-transform" />
                </span>
              </Link>
            </Reveal>
          ))}
        </div>

        <Reveal delay={0.2}>
          <div className="mt-12 text-center">
            <p className="text-ink-muted mb-4">Not Sure Where to Start?</p>
            <Link href="/contact" className="btn-primary">Find My Therapist <FiArrowRight /></Link>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
