"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { FiChevronDown } from "react-icons/fi";
import type { Faq } from "@/lib/queries";

export default function HomeFaqs({ faqs }: { faqs: Faq[] }) {
  const [openId, setOpenId] = useState<number | null>(faqs[0]?.id ?? null);
  if (!faqs.length) return null;

  return (
    <section className="section bg-white">
      <div className="container-narrow">
        <div className="text-center mb-14">
          <span className="eyebrow center">FAQs</span>
          <h2 className="display mt-5 text-4xl md:text-5xl text-ink leading-[1.05]">
            Quick answers to the things{" "}
            <span className="italic-accent">people ask most.</span>
          </h2>
          <p className="mt-4 text-ink-muted text-base md:text-lg leading-relaxed max-w-xl mx-auto">
            Don't see what you're looking for? Reach out — we're happy to help.
          </p>
        </div>

        <div className="border-t border-surface-line">
          {faqs.slice(0, 6).map((f) => {
            const open = openId === f.id;
            return (
              <div key={f.id} className="border-b border-surface-line">
                <button
                  onClick={() => setOpenId(open ? null : f.id)}
                  className="w-full flex items-center justify-between text-left py-5 sm:py-6 gap-6 group"
                  aria-expanded={open}
                >
                  <span className={`font-display text-lg md:text-xl leading-snug transition-colors ${open ? "text-brand-700" : "text-ink group-hover:text-brand-700"}`}>
                    {f.question}
                  </span>
                  <span
                    className={`w-9 h-9 grid place-items-center rounded-full border flex-shrink-0 transition-all duration-300 ${
                      open
                        ? "bg-brand text-white border-brand rotate-180"
                        : "bg-transparent text-ink-muted border-surface-line group-hover:border-brand group-hover:text-brand"
                    }`}
                    aria-hidden
                  >
                    <FiChevronDown size={16} />
                  </span>
                </button>
                <AnimatePresence initial={false}>
                  {open && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                      className="overflow-hidden"
                    >
                      <div className="pb-6 pr-12 text-ink-muted leading-relaxed text-base">
                        {f.answer}
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
  );
}
