"use client";

import Link from "next/link";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { FiCheck, FiArrowUpRight, FiPlus, FiMinus } from "react-icons/fi";

const tiers = [
  {
    name: "Standard",
    price: "$140",
    note: "Per 50-min session",
    features: ["Licensed clinician", "In-person or telehealth", "Most insurance accepted"],
    highlight: false,
  },
  {
    name: "Sliding Scale",
    price: "$70+",
    note: "Income-based",
    features: ["Reduced fee", "Limited slots available", "Apply through intake"],
    highlight: true,
  },
  {
    name: "Student Therapist",
    price: "$50",
    note: "Supervised graduate clinician",
    features: ["Great accessibility", "Weekly supervision", "Same care standards"],
    highlight: false,
  },
];

const RATE_FAQS = [
  {
    q: "Do you accept insurance?",
    a: "We accept most major Nevada insurance plans. Bring your card to the intake call and we'll verify benefits before your first session.",
  },
  {
    q: "How does the sliding scale work?",
    a: "Sliding-scale fees are based on household income. Apply through our intake form — we have a limited number of reduced-fee slots reserved for clients who need them.",
  },
  {
    q: "What if I can't afford weekly sessions?",
    a: "We can adjust cadence (biweekly is common) or pair you with a student therapist for the most affordable option without sacrificing care quality.",
  },
  {
    q: "Do you charge for cancellations?",
    a: "Cancellations within 24 hours of your appointment are charged the full session fee. We try to be flexible — just communicate with your therapist.",
  },
];

export default function RatesPage() {
  const [openIdx, setOpenIdx] = useState<number | null>(null);

  return (
    <>
      {/* Page header */}
      <section className="bg-cream-alt relative overflow-hidden">
        <div aria-hidden className="absolute inset-0 bg-grid opacity-[0.06]" />
        <div className="container-narrow relative py-20 sm:py-28 lg:py-32 text-center">
          <span className="eyebrow center">Rates</span>
          <h1 className="mt-6 display text-5xl sm:text-6xl lg:text-7xl text-ink">
            Affordable <span className="italic-accent">therapy.</span>
          </h1>
          <svg aria-hidden viewBox="0 0 200 8" className="mx-auto mt-7 w-36 h-2 text-brand">
            <path d="M2 5 Q 50 0 100 4 T 198 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <p className="mt-7 text-ink-muted text-lg sm:text-xl leading-relaxed max-w-2xl mx-auto">
            Transparent pricing — and several ways to lower the cost.
          </p>
        </div>
      </section>

      {/* Pricing — 3 cream cards */}
      <section className="section bg-white">
        <div className="container-x">
          <div className="grid md:grid-cols-3 gap-6 lg:gap-8">
            {tiers.map((t, i) => (
              <motion.div
                key={t.name}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-50px" }}
                transition={{ delay: i * 0.06 }}
                className={`relative h-full flex flex-col rounded-4xl border p-8 lg:p-10 transition-all duration-500 ${
                  t.highlight
                    ? "bg-cream-deep border-brand-300 shadow-card"
                    : "bg-cream border-surface-line shadow-soft hover:shadow-card"
                }`}
              >
                {t.highlight && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-brand text-white text-[11px] font-semibold uppercase tracking-[0.18em]">
                    Most flexible
                  </span>
                )}
                <div className="font-display text-xl text-ink">{t.name}</div>
                <div className="mt-4 pt-4 border-t border-surface-line">
                  <div className="flex items-baseline gap-2">
                    <span className="display text-6xl text-brand-700">{t.price}</span>
                  </div>
                  <div className="text-sm text-ink-muted mt-2">{t.note}</div>
                </div>
                <ul className="mt-7 space-y-3 text-sm text-ink flex-1">
                  {t.features.map((f) => (
                    <li key={f} className="flex gap-3">
                      <span className="mt-0.5 w-5 h-5 rounded-full bg-sage-100 text-sage-700 grid place-items-center shrink-0">
                        <FiCheck size={12} />
                      </span>
                      <span className="leading-relaxed">{f}</span>
                    </li>
                  ))}
                </ul>
                <Link
                  href="/contact"
                  className={`mt-8 ${t.highlight ? "btn-primary" : "btn-ghost"} w-full justify-center`}
                >
                  Get started <FiArrowUpRight />
                </Link>
              </motion.div>
            ))}
          </div>

          <p className="mt-10 text-center text-sm text-ink-soft max-w-xl mx-auto leading-relaxed">
            Rates listed are private-pay. We&apos;ll verify your insurance benefits during intake — most plans cover the bulk of session costs.
          </p>
        </div>
      </section>

      {/* FAQ */}
      <section className="section bg-cream">
        <div className="container-narrow">
          <div className="text-center mb-12">
            <span className="eyebrow center">Common questions</span>
            <h2 className="mt-5 display text-4xl sm:text-5xl text-ink">
              About our <span className="italic-accent">rates.</span>
            </h2>
          </div>

          <div className="divide-y divide-surface-line border-y border-surface-line">
            {RATE_FAQS.map((f, i) => {
              const open = openIdx === i;
              return (
                <div key={i}>
                  <button
                    onClick={() => setOpenIdx(open ? null : i)}
                    className="w-full flex items-center justify-between gap-6 text-left py-6 group"
                  >
                    <span className="font-display text-lg sm:text-xl text-ink group-hover:text-brand-700 transition">
                      {f.q}
                    </span>
                    <span className="shrink-0 w-9 h-9 rounded-full border border-surface-line grid place-items-center text-brand-700 group-hover:border-brand-700 transition">
                      {open ? <FiMinus size={15} /> : <FiPlus size={15} />}
                    </span>
                  </button>
                  <AnimatePresence initial={false}>
                    {open && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                        className="overflow-hidden"
                      >
                        <div className="pb-6 pr-12 text-ink-muted leading-[1.75] text-base">
                          {f.a}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
        </div>
      </section>
    </>
  );
}
