"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

/**
 * Auto-crossfading hero photo carousel — mirrors the brightertomorrowtherapy.com
 * therapist hero (Elementor image carousel, effect=fade, autoplay) for therapists
 * who have multiple photos. Single-photo therapists render a plain <img> upstream.
 * Honors prefers-reduced-motion by holding the first frame.
 */
export default function HeroPhotoCarousel({
  photos,
  alt,
  intervalMs = 3800,
}: {
  photos: string[];
  alt: string;
  intervalMs?: number;
}) {
  const [i, setI] = useState(0);
  const reduce = useReducedMotion();

  useEffect(() => {
    if (photos.length < 2 || reduce) return;
    const id = setInterval(() => setI((p) => (p + 1) % photos.length), intervalMs);
    return () => clearInterval(id);
  }, [photos.length, reduce, intervalMs]);

  return (
    <div className="relative w-full aspect-[4/5] rounded-[28px] overflow-hidden shadow-lg bg-cream-deep">
      <AnimatePresence initial={false} mode="sync">
        <motion.img
          key={photos[i] ?? i}
          src={photos[i]}
          alt={alt}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.9, ease: "easeInOut" }}
          className="absolute inset-0 w-full h-full object-cover object-top"
        />
      </AnimatePresence>
    </div>
  );
}
