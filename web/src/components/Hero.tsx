"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  motion, AnimatePresence, useReducedMotion, type Variants,
} from "framer-motion";
import { FiArrowRight, FiPhone, FiArrowDown } from "react-icons/fi";
import type { SiteSettings } from "@/lib/queries";

const HEADLINE_LINE_1 = "Las Vegas & North Las Vegas";
const HEADLINE_LINE_2 = "Therapy for Children, Teens & Adults";

export default function Hero({ settings }: { settings: SiteSettings }) {
  const reduce = useReducedMotion();

  // Crossfading background slideshow
  const slides: string[] =
    (settings.hero_images && settings.hero_images.length > 0
      ? settings.hero_images
      : settings.hero_image_url
        ? [settings.hero_image_url]
        : []);
  const [idx, setIdx] = useState(0);

  // Preload upcoming images so the crossfade is instant
  useEffect(() => {
    slides.forEach((src) => { const i = new Image(); i.src = src; });
  }, [slides]);

  useEffect(() => {
    if (reduce || slides.length < 2) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % slides.length), 5500);
    return () => clearInterval(t);
  }, [reduce, slides.length]);

  const lineV: Variants = {
    hidden: {},
    show:   { transition: { staggerChildren: 0.06, delayChildren: 0.1 } },
  };
  const wordV: Variants = {
    hidden: { y: "100%", opacity: 0 },
    show:   { y: 0, opacity: 1, transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] } },
  };

  return (
    <section className="relative isolate overflow-hidden text-white min-h-[640px] sm:min-h-[700px] lg:min-h-[760px] flex items-center">
      {/* Crossfading slideshow with slow Ken Burns zoom on the active slide */}
      <div aria-hidden className="absolute inset-0 -z-10">
        <AnimatePresence initial={false} mode="popLayout">
          <motion.div
            key={slides[idx] ?? "fallback"}
            className="absolute inset-0"
            initial={{ opacity: 0 }}
            animate={reduce ? { opacity: 1 } : { opacity: 1, scale: [1, 1.08] }}
            exit={{ opacity: 0 }}
            transition={{ opacity: { duration: 1.2, ease: "easeInOut" }, scale: { duration: 6.5, ease: "easeOut" } }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={slides[idx] ?? settings.hero_image_url ?? ""}
              alt=""
              className="w-full h-full object-cover"
            />
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Light overlay so the photo reads through (matches the original treatment) */}
      <div aria-hidden className="absolute inset-0 -z-10 bg-gradient-to-b from-[#2f1f16]/44 via-[#3f281b]/30 to-[#2a1b14]/68" />
      <div aria-hidden className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_70%_20%,rgba(185,135,82,0.18),transparent_60%)]" />

      {/* Soft floating dots */}
      {!reduce && [...Array(8)].map((_, i) => (
        <motion.span
          key={i}
          aria-hidden
          className="absolute w-1.5 h-1.5 rounded-full bg-white/40 pointer-events-none"
          style={{ top: `${10 + i * 11}%`, left: `${(i * 17 + 5) % 95}%` }}
          animate={{ y: [0, -18, 0], opacity: [0.2, 0.8, 0.2] }}
          transition={{ duration: 4 + i, repeat: Infinity, ease: "easeInOut", delay: i * 0.35 }}
        />
      ))}

      <div className="container-x relative w-full text-center py-20 sm:py-24 lg:py-32">
        <motion.div
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="inline-flex items-center gap-2 text-[11px] sm:text-xs uppercase tracking-[0.22em] font-semibold bg-white/10 backdrop-blur border border-white/15 px-3 py-1.5 rounded-full"
        >
          <span className="relative flex w-2 h-2">
            <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-300 opacity-75 animate-ping" />
            <span className="relative inline-flex w-2 h-2 rounded-full bg-emerald-400" />
          </span>
          Las Vegas · North Las Vegas · All of Nevada
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="serif italic text-brand-200 mt-5 text-base sm:text-lg"
        >
          {settings.brand_name}
        </motion.div>

        <h1 className="mt-3 mx-auto max-w-4xl text-[2.4rem] sm:text-5xl lg:text-[4.25rem] font-bold leading-[1.04] tracking-tight">
          <motion.span variants={lineV} initial="hidden" animate="show" className="block overflow-hidden pb-1">
            {HEADLINE_LINE_1.split(" ").map((w, i) => (
              <span key={i} className="inline-block overflow-hidden align-bottom mr-[0.25em]">
                <motion.span variants={wordV} className="inline-block">{w}</motion.span>
              </span>
            ))}
          </motion.span>
          <motion.span
            variants={lineV} initial="hidden" animate="show"
            className="block overflow-hidden pb-2 text-brand-300"
            transition={{ delayChildren: 0.4 }}
          >
            {HEADLINE_LINE_2.split(" ").map((w, i) => (
              <span key={i} className="inline-block overflow-hidden align-bottom mr-[0.25em]">
                <motion.span variants={wordV} className="inline-block">{w}</motion.span>
              </span>
            ))}
          </motion.span>
        </h1>

        <motion.p
          initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.85 }}
          className="mt-6 mx-auto max-w-2xl text-base sm:text-lg text-white/80 leading-relaxed"
        >
          Compassionate, accessible therapy — in person at our Las Vegas offices and online
          across Nevada. Evenings and weekends available.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 1.0 }}
          className="mt-8 flex flex-wrap gap-3 justify-center"
        >
          <Link
            href="/contact"
            className="inline-flex items-center gap-2 bg-brand text-white font-semibold uppercase tracking-wider text-sm px-6 py-3.5 rounded-full hover:bg-brand-600 hover:shadow-soft transition group"
          >
            Get Started
            <motion.span animate={{ x: [0, 4, 0] }} transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}>
              <FiArrowRight />
            </motion.span>
          </Link>
          <Link
            href="/contact"
            className="inline-flex items-center gap-2 bg-white text-brand font-semibold uppercase tracking-wider text-sm px-6 py-3.5 rounded-full hover:bg-brand-50 transition"
          >
            Make an Appointment
          </Link>
          {settings.primary_phone && (
            <a
              href={`tel:${settings.primary_phone}`}
              className="inline-flex items-center gap-2 border border-white/40 text-white font-semibold text-sm px-5 py-3.5 rounded-full hover:bg-white/10 transition"
            >
              <FiPhone /> {settings.primary_phone}
            </a>
          )}
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.4 }}
          className="mt-10 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs sm:text-sm text-white/70"
        >
          <span>In-person & online</span>
          <span className="opacity-50">·</span>
          <span>Most insurance accepted</span>
          <span className="opacity-50">·</span>
          <span>Evenings & weekends</span>
        </motion.div>
      </div>

      {/* Slide indicator dots */}
      {slides.length > 1 && (
        <div className="absolute bottom-7 left-0 right-0 flex justify-center gap-2 z-10">
          {slides.map((_, i) => (
            <button
              key={i}
              aria-label={`Show slide ${i + 1}`}
              onClick={() => setIdx(i)}
              className={`h-1.5 rounded-full transition-all ${
                idx === i ? "w-8 bg-white" : "w-2 bg-white/40 hover:bg-white/70"
              }`}
            />
          ))}
        </div>
      )}

      {/* Scroll indicator */}
      {!reduce && (
        <motion.a
          href="#after-hero"
          aria-label="Scroll to content"
          className="hidden md:flex absolute left-1/2 -translate-x-1/2 bottom-8 w-10 h-10 rounded-full border border-white/40 text-white items-center justify-center bg-white/10 backdrop-blur hover:bg-white hover:text-brand transition"
          animate={{ y: [0, 6, 0], opacity: [0.7, 1, 0.7] }}
          transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
        >
          <FiArrowDown />
        </motion.a>
      )}
      <span id="after-hero" />
    </section>
  );
}
