"use client";

import { useState } from "react";
import { FiChevronDown } from "react-icons/fi";

export type AffordableFaqItem = {
  q: string;
  a: string;
  list?: string[];
};

export default function AffordableFaq({ items }: { items: AffordableFaqItem[] }) {
  const [openIdx, setOpenIdx] = useState<number | null>(0);

  return (
    <ul className="mt-12 divide-y divide-surface-line border-y border-surface-line">
      {items.map((item, i) => {
        const open = openIdx === i;
        return (
          <li key={item.q}>
            <button
              type="button"
              onClick={() => setOpenIdx(open ? null : i)}
              className="w-full flex items-start justify-between gap-6 py-6 text-left group"
              aria-expanded={open}
            >
              <span className="font-display text-xl sm:text-2xl text-ink leading-snug group-hover:text-brand-700 transition">
                {item.q}
              </span>
              <FiChevronDown
                className={`mt-1 shrink-0 w-5 h-5 text-brand-700 transition-transform duration-300 ${
                  open ? "rotate-180" : ""
                }`}
              />
            </button>
            <div
              className={`grid transition-all duration-300 ease-out ${
                open ? "grid-rows-[1fr] opacity-100 pb-6" : "grid-rows-[0fr] opacity-0"
              }`}
            >
              <div className="overflow-hidden">
                {item.list && (
                  <ul className="list-disc pl-6 text-ink-muted leading-relaxed space-y-2 mb-4">
                    {item.list.map((b) => (
                      <li key={b}>{b}</li>
                    ))}
                  </ul>
                )}
                <p className="text-ink-muted leading-relaxed">{item.a}</p>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
