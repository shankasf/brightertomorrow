"use client";

import { motion } from "framer-motion";
import { FiPhone, FiUsers, FiCalendar } from "react-icons/fi";
import type { ReactNode } from "react";

const STEPS: { icon: ReactNode; title: string; body: string; n: string }[] = [
  {
    n: "01",
    icon: <FiPhone />,
    title: "Reach out",
    body: "Tell us a little about what you're looking for in a therapist — concern, preferences, schedule.",
  },
  {
    n: "02",
    icon: <FiUsers />,
    title: "Get matched",
    body: "Our intake team pairs you with a clinician who fits — usually within one business day.",
  },
  {
    n: "03",
    icon: <FiCalendar />,
    title: "Start therapy",
    body: "Book in person at one of our offices or via secure telehealth. Evenings and weekends available.",
  },
];

export default function Process() {
  return (
    <section className="section bg-surface-alt relative overflow-hidden">
      <div className="container-x">
        <div className="text-center max-w-2xl mx-auto">
          <span className="text-xs uppercase tracking-[0.2em] text-brand font-semibold">How it works</span>
          <h2 className="mt-2 text-3xl md:text-4xl font-bold text-ink">From first call to first session.</h2>
          <p className="mt-3 text-ink-muted">A simple, low-pressure path to working with a therapist who fits.</p>
        </div>

        <div className="mt-12 grid md:grid-cols-3 gap-6 relative">
          {/* Connector line */}
          <div className="hidden md:block absolute top-12 left-[16%] right-[16%] h-px bg-gradient-to-r from-transparent via-brand/40 to-transparent" aria-hidden />

          {STEPS.map((s, i) => (
            <motion.div
              key={s.n}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.5, delay: i * 0.1 }}
              className="relative bg-white rounded-2xl border border-surface-line p-6 hover:border-brand hover:shadow-soft transition group"
            >
              <div className="flex items-start justify-between">
                <div className="w-12 h-12 rounded-2xl bg-brand-50 text-brand grid place-items-center text-xl group-hover:bg-brand group-hover:text-white transition">
                  {s.icon}
                </div>
                <span className="font-display text-sm font-bold text-brand/30">{s.n}</span>
              </div>
              <h3 className="mt-5 font-display text-xl font-semibold text-ink">{s.title}</h3>
              <p className="mt-2 text-sm text-ink-muted leading-relaxed">{s.body}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
