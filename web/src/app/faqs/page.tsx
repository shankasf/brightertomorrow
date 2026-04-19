"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { FiPlus, FiMinus } from "react-icons/fi";

type Faq = { id: number; question: string; answer: string; category: string | null };

export default function FaqsPage() {
  const [faqs, setFaqs] = useState<Faq[]>([]);
  const [openId, setOpenId] = useState<number | null>(null);

  useEffect(() => { fetch("/v1/faqs").then((r) => r.json()).then(setFaqs); }, []);

  return (
    <>
      <section className="bg-hero-gradient">
        <div className="container-x py-10 sm:py-14 lg:py-16 text-center">
          <span className="text-xs uppercase tracking-[0.2em] text-brand font-semibold">FAQs</span>
          <h1 className="mt-2 text-3xl sm:text-4xl md:text-5xl font-bold text-ink">Frequently asked questions.</h1>
        </div>
      </section>
      <section className="section !py-10 sm:!py-14 lg:!py-20">
        <div className="container-x max-w-3xl space-y-3">
          {faqs.map((f) => {
            const open = openId === f.id;
            return (
              <div key={f.id} className="bg-white border border-surface-line rounded-2xl overflow-hidden">
                <button
                  onClick={() => setOpenId(open ? null : f.id)}
                  className="w-full flex items-center justify-between text-left px-4 sm:px-5 py-3.5 sm:py-4 min-h-[44px] gap-3 hover:bg-surface-alt transition"
                >
                  <span className="font-display font-semibold text-ink break-words">{f.question}</span>
                  {open ? <FiMinus className="text-brand flex-shrink-0" /> : <FiPlus className="text-brand flex-shrink-0" />}
                </button>
                <AnimatePresence initial={false}>
                  {open && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="px-4 sm:px-5 pb-4 sm:pb-5 text-ink-muted leading-relaxed break-words">{f.answer}</div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      </section>
    </>
  );
}
