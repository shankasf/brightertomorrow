"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { FiPlus, FiMinus } from "react-icons/fi";
import type { Faq } from "@/lib/queries";

export default function HomeFaqs({ faqs }: { faqs: Faq[] }) {
  const [openId, setOpenId] = useState<number | null>(faqs[0]?.id ?? null);
  if (!faqs.length) return null;

  return (
    <section className="section !py-12 sm:!py-16 lg:!py-20 bg-surface-alt">
      <div className="container-x grid lg:grid-cols-12 gap-10 items-start">
        <div className="lg:col-span-5">
          <span className="text-xs uppercase tracking-[0.2em] text-brand font-semibold">FAQs</span>
          <h2 className="mt-2 text-3xl sm:text-4xl font-bold text-ink leading-tight">
            Quick answers to the things people ask most.
          </h2>
          <p className="mt-3 text-ink-muted">
            Don't see what you're looking for? Reach out — we're happy to help.
          </p>
        </div>

        <div className="lg:col-span-7 space-y-3">
          {faqs.slice(0, 6).map((f) => {
            const open = openId === f.id;
            return (
              <div key={f.id} className="bg-white border border-surface-line rounded-2xl overflow-hidden">
                <button
                  onClick={() => setOpenId(open ? null : f.id)}
                  className="w-full flex items-center justify-between text-left px-4 sm:px-5 py-3.5 sm:py-4 min-h-[48px] gap-3 hover:bg-surface transition"
                  aria-expanded={open}
                >
                  <span className="font-display font-semibold text-ink break-words">{f.question}</span>
                  <span className="w-8 h-8 grid place-items-center rounded-full bg-brand-50 text-brand flex-shrink-0">
                    {open ? <FiMinus /> : <FiPlus />}
                  </span>
                </button>
                <AnimatePresence initial={false}>
                  {open && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="px-4 sm:px-5 pb-5 text-ink-muted leading-relaxed break-words">{f.answer}</div>
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
