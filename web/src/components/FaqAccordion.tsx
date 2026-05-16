"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { FiChevronDown } from "react-icons/fi";
import type { Faq } from "@/lib/queries";

export default function FaqAccordion({
  grouped,
  showCategoryLabels,
}: {
  grouped: [string, Faq[]][];
  showCategoryLabels: boolean;
}) {
  const [openId, setOpenId] = useState<number | null>(null);

  return (
    <div>
      {grouped.map(([category, items], gi) => (
        <div key={category} className={gi > 0 ? "mt-16" : ""}>
          {showCategoryLabels && (
            <div className="mb-6">
              <span className="eyebrow">{category}</span>
            </div>
          )}
          <div className="border-y border-surface-line divide-y divide-surface-line">
            {items.map((f) => {
              const open = openId === f.id;
              return (
                <div key={f.id}>
                  <button
                    onClick={() => setOpenId(open ? null : f.id)}
                    className="w-full flex items-center justify-between gap-3 sm:gap-6 text-left py-6 sm:py-7 group min-h-[44px]"
                    aria-expanded={open}
                  >
                    <span className="font-display text-[1.05rem] sm:text-xl text-ink break-words group-hover:text-brand-700 transition-colors">
                      {f.question}
                    </span>
                    <motion.span
                      animate={{ rotate: open ? 180 : 0 }}
                      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                      className="shrink-0 w-10 h-10 sm:w-9 sm:h-9 rounded-full border border-surface-line grid place-items-center text-brand-700 group-hover:border-brand-700 transition-colors"
                    >
                      <FiChevronDown size={15} />
                    </motion.span>
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
                        <div className="pb-7 pr-4 sm:pr-12 text-ink-muted leading-[1.85] text-base sm:text-lg break-words">
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
      ))}
    </div>
  );
}
