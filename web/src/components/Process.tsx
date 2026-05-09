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
    <section className="section bg-cream-gradient relative overflow-hidden">
      <div className="container-x">
        <div className="text-center max-w-2xl mx-auto">
          <span className="eyebrow center">How it works</span>
          <h2 className="display mt-5 text-4xl md:text-5xl text-ink leading-[1.05]">
            From first call to{" "}
            <span className="italic-accent">first session.</span>
          </h2>
          <p className="mt-4 text-ink-muted text-base md:text-lg leading-relaxed">
            A simple, low-pressure path to working with a therapist who fits.
          </p>
        </div>

        <div className="mt-16 relative">
          {/* Hairline connector — desktop horizontal, mobile vertical */}
          <div
            className="hidden md:block absolute top-9 left-[12%] right-[12%] h-px bg-gradient-to-r from-transparent via-brand/30 to-transparent pointer-events-none"
            aria-hidden
          />

          <div className="grid md:grid-cols-3 gap-10 md:gap-8 relative">
            {STEPS.map((s, i) => (
              <motion.div
                key={s.n}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{ duration: 0.5, delay: i * 0.1, ease: [0.16, 1, 0.3, 1] }}
                className="group relative flex flex-col items-center text-center md:px-4"
              >
                {/* Numbered serif circle */}
                <div className="relative z-10">
                  <div className="w-[72px] h-[72px] rounded-full bg-cream border border-surface-line grid place-items-center transition-all duration-300 group-hover:border-sage group-hover:bg-sage/5 group-hover:shadow-soft">
                    <span className="font-display text-2xl text-brand-700 transition-colors duration-300 group-hover:text-sage">
                      {s.n}
                    </span>
                  </div>
                  <span
                    className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-cream border border-surface-line grid place-items-center text-ink-muted transition-colors duration-300 group-hover:text-sage group-hover:border-sage"
                    aria-hidden
                  >
                    <span className="text-xs">{s.icon}</span>
                  </span>
                </div>

                <h3 className="mt-7 font-display text-xl md:text-2xl font-medium text-ink leading-snug">
                  {s.title}
                </h3>
                <p className="mt-3 text-sm text-ink-muted leading-relaxed max-w-[28ch]">
                  {s.body}
                </p>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
