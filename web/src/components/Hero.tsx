"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { FiCheck, FiShield } from "react-icons/fi";
import type { SiteSettings } from "@/lib/queries";
import MatchModal from "./MatchModal";
import CoverageModal from "./CoverageModal";

const HEADLINE =
  "Las Vegas Therapy Services For Children, Teens and Adults";

export default function Hero({ settings }: { settings: SiteSettings }) {
  const reduce = useReducedMotion();
  const [matchOpen, setMatchOpen] = useState(false);
  const [coverageOpen, setCoverageOpen] = useState(false);

  // Crossfading slideshow
  const slides: string[] =
    (settings.hero_images && settings.hero_images.length > 0
      ? settings.hero_images
      : settings.hero_image_url
        ? [settings.hero_image_url]
        : []);
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    slides.forEach((src) => { const i = new Image(); i.src = src; });
  }, [slides]);

  useEffect(() => {
    if (reduce || slides.length < 2) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % slides.length), 5500);
    return () => clearInterval(t);
  }, [reduce, slides.length]);

  const primaryImage = slides[idx] ?? settings.hero_image_url ?? "";

  return (
    <>
    <section
      className="relative isolate overflow-hidden"
      style={{ backgroundColor: "#192735" }}
    >
      {/* Background image (crossfading) */}
      <div className="absolute inset-0 -z-10">
        <AnimatePresence initial={false} mode="popLayout">
          <motion.div
            key={primaryImage || "fallback"}
            className="absolute inset-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.2, ease: "easeInOut" }}
          >
            {primaryImage && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={primaryImage}
                alt=""
                aria-hidden
                className="w-full h-full object-cover"
              />
            )}
          </motion.div>
        </AnimatePresence>
        {/* Darkening overlay for text legibility */}
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(180deg, rgba(25,39,53,0.55) 0%, rgba(25,39,53,0.65) 50%, rgba(25,39,53,0.78) 100%)",
          }}
        />
      </div>

      {/* Content */}
      <div className="container-x relative w-full pt-20 pb-24 sm:pt-28 sm:pb-32 lg:pt-32 lg:pb-40">
        <div className="max-w-4xl mx-auto text-center">
          {/* Wine "Find Your Therapist Here" badge */}
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="inline-flex items-center"
          >
            <button
              type="button"
              onClick={() => setMatchOpen(true)}
              className="inline-flex items-center gap-2 text-white text-[11px] font-semibold uppercase tracking-[0.18em] px-5 py-2.5 hover:opacity-90 transition"
              style={{ backgroundColor: "#66202A", borderRadius: "20px 0 20px 20px" }}
            >
              Find Your Therapist Here
            </button>
          </motion.div>

          {/* Brand script preheader */}
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.15 }}
            className="script mt-6 text-lg sm:text-xl"
            style={{ color: "#E1B878" }}
          >
            {settings.brand_name}
          </motion.div>

          {/* Main headline */}
          <motion.h1
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="display mt-5 text-[2.1rem] sm:text-5xl lg:text-[4.5rem] xl:text-[5rem] leading-[1.12] tracking-[-0.022em]"
            style={{ color: "#FFFFFF", fontWeight: 700 }}
          >
            {HEADLINE}
          </motion.h1>

          {/* Body copy */}
          <motion.p
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.55 }}
            className="mt-7 max-w-2xl mx-auto text-base sm:text-lg leading-relaxed"
            style={{ color: "rgba(255,255,255,0.85)" }}
          >
            Therapy for individuals, couples &amp; families.
            In-person or online &middot; Evenings &amp; weekends.
          </motion.p>

          {/* CTAs — Talkspace-style flow */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.75 }}
            className="mt-9 flex flex-wrap items-center justify-center gap-4"
          >
            <button
              type="button"
              onClick={() => setMatchOpen(true)}
              className="btn-primary"
            >
              Get Started
            </button>
            <button
              type="button"
              onClick={() => setCoverageOpen(true)}
              className="inline-flex items-center justify-center gap-2 text-white border border-white/40 hover:border-white hover:bg-white/10 px-6 py-4 font-semibold uppercase tracking-[0.12em] text-[0.82rem] leading-none transition"
              style={{ borderRadius: "20px 0 20px 20px" }}
            >
              <FiShield size={14} /> Check Your Coverage
            </button>
          </motion.div>

          {/* Trust microcopy */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 1.0 }}
            className="mt-5 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[12.5px]"
            style={{ color: "rgba(255,255,255,0.78)" }}
          >
            <span className="inline-flex items-center gap-1.5">
              <FiCheck size={13} style={{ color: "#E1B878" }} /> Most insured members have a $0 copay
            </span>
            <span aria-hidden className="hidden sm:inline w-1 h-1 rounded-full bg-white/30" />
            <span className="inline-flex items-center gap-1.5">
              <FiCheck size={13} style={{ color: "#E1B878" }} /> HIPAA-secure
            </span>
            <span aria-hidden className="hidden sm:inline w-1 h-1 rounded-full bg-white/30" />
            <span className="inline-flex items-center gap-1.5">
              <FiCheck size={13} style={{ color: "#E1B878" }} /> No credit card to get matched
            </span>
          </motion.div>

          {/* AI 24/7 booking line — glass call strip */}
          <motion.a
            href="tel:+17254652385"
            aria-label="Call our AI booking assistant at (725) 465-2385, available 24/7"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 1.15, ease: [0.22, 1, 0.36, 1] }}
            className="group mt-8 inline-flex flex-wrap items-center justify-center gap-x-3 gap-y-2 px-5 sm:px-6 py-3.5 backdrop-blur-md transition-all duration-300 hover:-translate-y-0.5"
            style={{
              background: "rgba(255,255,255,0.08)",
              border: "1px solid rgba(255,255,255,0.22)",
              borderRadius: "18px 0 18px 18px",
              boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
            }}
          >
            <span
              aria-hidden
              className="inline-flex items-center gap-1.5 text-[9.5px] sm:text-[10px] font-bold uppercase tracking-[0.2em] px-2 py-[5px]"
              style={{
                backgroundColor: "#E1B878",
                color: "#66202A",
                borderRadius: "8px 0 8px 8px",
              }}
            >
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#66202A] animate-pulse" />
              AI &middot; Available 24 / 7
            </span>
            <span className="text-[13px] sm:text-[13.5px] text-white/85 font-medium">
              Talk to AI to book
            </span>
            <span
              className="font-display text-[1.15rem] sm:text-[1.3rem] font-bold tabular tracking-tight text-white group-hover:text-[#E1B878] transition-colors"
            >
              (725) 465-2385
            </span>
          </motion.a>

          {/* Slide indicator pills */}
          {slides.length > 1 && (
            <div className="mt-12 flex justify-center gap-2">
              {slides.map((_, i) => (
                <button
                  key={i}
                  aria-label={`Show slide ${i + 1}`}
                  onClick={() => setIdx(i)}
                  className="h-1.5 rounded-full transition-all"
                  style={{
                    width: idx === i ? "28px" : "12px",
                    backgroundColor: idx === i ? "#E1B878" : "rgba(255,255,255,0.5)",
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <span id="after-hero" />
    </section>

    {/* Multi-step flows — Talkspace-style. Rendered outside <section> so the
        modal overlays escape the hero stacking context. */}
    <MatchModal open={matchOpen} onClose={() => setMatchOpen(false)} />
    <CoverageModal open={coverageOpen} onClose={() => setCoverageOpen(false)} />
    </>
  );
}
