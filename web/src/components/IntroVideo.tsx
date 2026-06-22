"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { FiPlay, FiMaximize2, FiX } from "react-icons/fi";

const POSTER = "/media/home-intro-poster.jpg";
const SOURCES = [{ src: "/media/home-intro.mp4", type: "video/mp4" }];

export default function IntroVideo() {
  const inlineRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  // Lock background scroll + Escape-to-close while the lightbox is open.
  useEffect(() => {
    if (!expanded) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // Pause the inline player so audio doesn't double up.
    inlineRef.current?.pause();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [expanded]);

  function playInline() {
    const v = inlineRef.current;
    if (!v) return;
    v.play();
    setPlaying(true);
  }

  return (
    <div className="mt-9 max-w-xl">
      {/* Framed inline player */}
      <div className="relative group">
        {/* Decorative offset backing panel */}
        <span
          aria-hidden
          className="absolute -bottom-3 -right-3 w-full h-full bg-brand-100/70 -z-10"
          style={{ borderRadius: "24px 0 24px 24px" }}
        />

        <div
          className="relative overflow-hidden bg-ink shadow-card ring-1 ring-surface-line"
          style={{ borderRadius: "24px 0 24px 24px" }}
        >
          <div className="aspect-video">
            <video
              ref={inlineRef}
              poster={POSTER}
              controls={playing}
              playsInline
              preload="none"
              className="h-full w-full object-cover"
              onEnded={() => setPlaying(false)}
            >
              {SOURCES.map((s) => (
                <source key={s.src} src={s.src} type={s.type} />
              ))}
            </video>
          </div>

          {/* Play overlay (hidden once playing) */}
          {!playing && (
            <button
              type="button"
              onClick={playInline}
              aria-label="Play intro video"
              className="absolute inset-0 grid place-items-center bg-ink/20 transition-colors hover:bg-ink/10"
            >
              <span className="grid h-16 w-16 place-items-center rounded-full bg-white/95 text-brand-700 shadow-soft transition-transform duration-300 group-hover:scale-105">
                <FiPlay size={26} className="ml-1" fill="currentColor" />
              </span>
            </button>
          )}

          {/* Maximize button */}
          <button
            type="button"
            onClick={() => setExpanded(true)}
            aria-label="Maximize video"
            className="absolute right-3 top-3 grid h-10 w-10 place-items-center rounded-full bg-ink/55 text-white backdrop-blur-sm transition hover:bg-ink/75 focus:outline-none focus:ring-2 focus:ring-white/70"
          >
            <FiMaximize2 size={17} />
          </button>
        </div>
      </div>

      {/* Lightbox */}
      {mounted &&
        createPortal(
          <AnimatePresence>
            {expanded && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                onClick={() => setExpanded(false)}
                className="fixed inset-0 z-[80] grid place-items-center bg-ink/85 p-4 backdrop-blur-sm sm:p-8"
                role="dialog"
                aria-modal="true"
                aria-label="Intro video"
              >
                <button
                  type="button"
                  onClick={() => setExpanded(false)}
                  aria-label="Close video"
                  className="absolute right-4 top-4 grid h-11 w-11 place-items-center rounded-full bg-white/10 text-white transition hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-white/70"
                >
                  <FiX size={20} />
                </button>

                <motion.div
                  initial={{ opacity: 0, scale: 0.96 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.97 }}
                  transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                  onClick={(e) => e.stopPropagation()}
                  className="w-full max-w-5xl overflow-hidden rounded-2xl bg-black shadow-card"
                >
                  <video
                    key={expanded ? "open" : "closed"}
                    poster={POSTER}
                    controls
                    autoPlay
                    playsInline
                    className="aspect-video w-full"
                  >
                    {SOURCES.map((s) => (
                      <source key={s.src} src={s.src} type={s.type} />
                    ))}
                  </video>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </div>
  );
}
