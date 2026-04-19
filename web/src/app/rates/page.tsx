import Link from "next/link";
import Reveal from "@/components/Reveal";

export const metadata = { title: "Rates — Brighter Tomorrow Therapy" };

const tiers = [
  { name: "Standard", price: "$140", note: "Per 50-min session", features: ["Licensed clinician", "In-person or telehealth", "Most insurance accepted"] },
  { name: "Sliding Scale", price: "$70+", note: "Income-based", features: ["Reduced fee", "Limited slots available", "Apply through intake"] },
  { name: "Student Therapist", price: "$50", note: "Supervised graduate clinician", features: ["Great accessibility", "Weekly supervision", "Same care standards"] },
];

export default function RatesPage() {
  return (
    <>
      <section className="bg-hero-gradient">
        <div className="container-x py-10 sm:py-14 lg:py-16 text-center">
          <span className="text-xs uppercase tracking-[0.2em] text-brand font-semibold">Rates</span>
          <h1 className="mt-2 text-3xl sm:text-4xl md:text-5xl font-bold text-ink">Affordable therapy.</h1>
          <p className="mt-3 text-ink-muted">Transparent pricing — and several ways to lower the cost.</p>
        </div>
      </section>
      <section className="section !py-10 sm:!py-14 lg:!py-20">
        <div className="container-x grid sm:grid-cols-2 md:grid-cols-3 gap-4 sm:gap-5 lg:gap-6">
          {tiers.map((t, i) => (
            <Reveal key={t.name} delay={i * 0.05}>
              <div className="bg-white border border-surface-line rounded-2xl p-6 hover:border-brand hover:shadow-soft transition h-full flex flex-col">
                <div className="font-display text-lg text-ink font-semibold">{t.name}</div>
                <div className="font-display text-4xl font-bold text-brand mt-2">{t.price}</div>
                <div className="text-sm text-ink-muted">{t.note}</div>
                <ul className="mt-5 space-y-2 text-sm text-ink">
                  {t.features.map((f) => <li key={f} className="flex gap-2"><span className="text-brand">✓</span>{f}</li>)}
                </ul>
                <Link href="/contact" className="btn-primary mt-6 self-start">Get Started</Link>
              </div>
            </Reveal>
          ))}
        </div>
      </section>
    </>
  );
}
