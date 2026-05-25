"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { FiX } from "react-icons/fi";

const WINE = "#66202A";
const INK = "#192735";

const JOTFORM_URL = "https://form.jotform.com/253014448330448";

// "Non-annoying intervals": never show in the first few seconds, require a bit of
// scrolling OR dwell time, and once dismissed/shown stay quiet for a cooldown that
// persists across page navigations (localStorage). It can reappear later as the
// visitor keeps browsing, but never back-to-back.
const COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes between appearances
const MIN_DWELL_MS = 8 * 1000; // never within the first 8s on a page
const FALLBACK_MS = 28 * 1000; // show by ~28s even without much scrolling
const SCROLL_TRIGGER = 0.35; // or once 35% of the page is scrolled
const STORAGE_KEY = "bt_find_therapist_popup_last";

export default function TherapistPopup() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    // Respect the cooldown across pages.
    let last = 0;
    try {
      last = Number(localStorage.getItem(STORAGE_KEY) || 0);
    } catch {
      /* private mode / disabled storage — treat as never shown */
    }
    if (Date.now() - last < COOLDOWN_MS) return;

    const mountedAt = Date.now();
    let done = false;
    let pending = false; // a trigger fired but was deferred (chat was open)
    // The chat widget broadcasts its open state via the `bt:chat` event and a
    // synchronous window flag. Never pop over a live conversation.
    let chatOpen = !!(window as unknown as { __btChatOpen?: boolean }).__btChatOpen;

    const reveal = () => {
      if (done) return;
      // Defer while the chat is open — re-tried when the chat closes. Do NOT
      // burn the cooldown here, so it can still appear later.
      if (chatOpen) {
        pending = true;
        return;
      }
      done = true;
      cleanup();
      setOpen(true);
      try {
        localStorage.setItem(STORAGE_KEY, String(Date.now()));
      } catch {
        /* ignore */
      }
    };

    const onScroll = () => {
      if (Date.now() - mountedAt < MIN_DWELL_MS) return;
      const doc = document.documentElement;
      const scrollable = doc.scrollHeight - doc.clientHeight;
      const depth = scrollable > 0 ? doc.scrollTop / scrollable : 0;
      if (depth >= SCROLL_TRIGGER) reveal();
    };

    const onChat = (e: Event) => {
      chatOpen = !!(e as CustomEvent<{ open?: boolean }>).detail?.open;
      if (chatOpen) {
        // Chat just opened — hide the popup if it's showing and stop pestering.
        setOpen(false);
      } else if (pending && !done) {
        // Chat closed and a trigger was waiting — show after a short beat.
        pending = false;
        window.setTimeout(reveal, 600);
      }
    };

    const fallback = window.setTimeout(reveal, FALLBACK_MS);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("bt:chat", onChat);

    function cleanup() {
      window.clearTimeout(fallback);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("bt:chat", onChat);
    }
    return cleanup;
  }, []);

  const close = () => setOpen(false);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[120] flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          onClick={close}
          role="dialog"
          aria-modal="true"
          aria-label="Find your therapist"
        >
          <div
            className="absolute inset-0"
            style={{ backgroundColor: "rgba(15,22,30,0.55)" }}
            aria-hidden
          />
          <motion.div
            className="relative w-full max-w-[420px] bg-white text-center px-8 py-10 shadow-2xl"
            style={{ borderRadius: "24px" }}
            initial={{ opacity: 0, scale: 0.92, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={close}
              aria-label="Close"
              className="absolute right-4 top-4 grid h-8 w-8 place-items-center rounded-full text-ink-soft transition hover:bg-black/5 hover:text-ink"
            >
              <FiX size={20} />
            </button>

            <h2
              className="font-display font-bold uppercase tracking-[0.08em] text-[22px] sm:text-[24px] leading-snug"
              style={{ color: INK }}
            >
              Find Your Therapist Here
            </h2>

            <a
              href={JOTFORM_URL}
              target="_blank"
              rel="noopener noreferrer"
              onClick={close}
              className="mt-7 inline-block font-display font-bold tracking-[0.12em] text-[14px] uppercase px-10 py-4 text-white transition hover:opacity-90"
              style={{ backgroundColor: WINE, borderRadius: "30px 0 30px 30px" }}
            >
              Click here
            </a>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
