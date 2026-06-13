"use client";

import Link from "next/link";
import { useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { FiChevronDown } from "react-icons/fi";
import Reveal from "@/components/Reveal";
import { FAQS, type Faq } from "./faqs-data";

const WINE = "#66202A";
const GOLD = "#E1B878";
const INK = "#192735";

function FaqItem({
  q,
  a,
  open,
  onToggle,
  reduce,
}: {
  q: string;
  a: string;
  open: boolean;
  onToggle: () => void;
  reduce: boolean;
}) {
  return (
    <div
      className="overflow-hidden"
      style={{
        backgroundColor: WINE,
        color: "#F4F4F4",
        borderRadius: "30px 0 30px 30px",
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-4 px-6 sm:px-8 py-5 text-left font-display font-semibold text-[15px] sm:text-[17px] leading-snug transition hover:opacity-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:#E1B878]"
      >
        <span>{q}</span>
        <motion.span
          aria-hidden
          animate={{ rotate: open ? 180 : 0 }}
          transition={
            reduce ? { duration: 0 } : { duration: 0.3, ease: [0.16, 1, 0.3, 1] }
          }
          className="shrink-0"
          style={{ color: GOLD }}
        >
          <FiChevronDown size={22} strokeWidth={2.5} />
        </motion.span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="content"
            initial={reduce ? false : { height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={
              reduce ? { duration: 0 } : { duration: 0.35, ease: [0.16, 1, 0.3, 1] }
            }
            className="overflow-hidden"
          >
            <div className="px-6 sm:px-8 pb-6 text-[14.5px] leading-[1.7] text-white/90 whitespace-pre-line">
              {a}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function FaqsContent() {
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const reduce = !!useReducedMotion();

  // Split FAQs into 2-column layout for desktop — preserve top-to-bottom-by-column ordering
  const mid = Math.ceil(FAQS.length / 2);
  const left = FAQS.slice(0, mid);
  const right = FAQS.slice(mid);

  const renderItem = (item: Faq, absIdx: number) => (
    <FaqItem
      key={item.q}
      q={item.q}
      a={item.a}
      open={openIdx === absIdx}
      onToggle={() => setOpenIdx(openIdx === absIdx ? null : absIdx)}
      reduce={reduce}
    />
  );

  return (
    <article className="bg-cream-alt">
      {/* HERO — Nevada mountain photo with navy overlay (matches .com /faqs/) */}
      <section className="relative overflow-hidden">
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{
            backgroundImage:
              "linear-gradient(rgba(25,39,53,0.55), rgba(25,39,53,0.6)), url('/images/faqs/nevada-mountain.webp')",
          }}
          aria-hidden
        />
        <div className="relative container-x py-28 sm:py-36 lg:py-44 text-center">
          <Reveal direction="up">
            <h1
              className="font-display font-bold leading-tight text-[40px] sm:text-[52px] lg:text-[60px]"
              style={{ color: "#F4F4F4" }}
            >
              <span style={{ color: GOLD }}>Frequently</span> Asked Question
            </h1>
          </Reveal>
        </div>
      </section>

      {/* ACCORDION — wine pill cards on cream-alt (matches .com layout) */}
      <section className="bg-cream-alt py-16 sm:py-20 lg:py-24">
        <div className="container-x max-w-[1180px]">
          <div className="grid md:grid-cols-2 gap-5 md:gap-6">
            <div className="space-y-5 md:space-y-6">
              {left.map((it, i) => renderItem(it, i))}
            </div>
            <div className="space-y-5 md:space-y-6">
              {right.map((it, i) => renderItem(it, mid + i))}
            </div>
          </div>
        </div>
      </section>

      {/* CTA — photo bg + navy overlay (matches .com /faqs bottom) */}
      <section className="relative overflow-hidden">
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{
            backgroundImage:
              "linear-gradient(rgba(25,39,53,0.7), rgba(25,39,53,0.7)), url('/images/faqs/cta-bg.jpg')",
          }}
          aria-hidden
        />
        <div className="relative container-x py-20 lg:py-28 text-center">
          <Reveal direction="up">
            <p
              className="font-script italic text-[20px] sm:text-[24px]"
              style={{ color: GOLD }}
            >
              Ready to begin your healing journey?
            </p>
            <h2 className="mt-3 font-display font-bold text-[32px] sm:text-[40px] lg:text-[45px] text-white leading-[1.15]">
              Take the first step on the path toward a{" "}
              <span style={{ color: GOLD }}>brighter tomorrow</span>!
            </h2>
            <div className="mt-8 flex justify-center">
              <Link
                href="/contact"
                className="inline-block font-display font-bold tracking-[0.15em] text-[13px] uppercase px-8 py-4 transition hover:opacity-90"
                style={{
                  backgroundColor: GOLD,
                  color: INK,
                  borderRadius: "30px 0 30px 30px",
                }}
              >
                Consultation Now
              </Link>
            </div>
          </Reveal>
        </div>
      </section>
    </article>
  );
}
