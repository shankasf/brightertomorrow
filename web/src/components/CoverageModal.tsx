"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { FiCheck, FiX, FiShield, FiArrowRight } from "react-icons/fi";

type Insurer = {
  id: string;
  name: string;
  accepted: boolean;
  estimate: string;
};

const INSURERS: Insurer[] = [
  { id: "aetna",   name: "Aetna",                  accepted: true,  estimate: "$0 – $40" },
  { id: "cigna",   name: "Cigna",                  accepted: true,  estimate: "$0 – $35" },
  { id: "anthem",  name: "Anthem",                 accepted: true,  estimate: "$0 – $40" },
  { id: "silver",  name: "Silver Summit",          accepted: true,  estimate: "$0 – $25" },
  { id: "uhc",     name: "United Health Care (Medicare)", accepted: true,  estimate: "$0 – $30" },
  { id: "self",    name: "Self-pay / Out of pocket", accepted: true, estimate: "From $90 / session" },
  { id: "other",   name: "Other / not listed",     accepted: false, estimate: "We can verify" },
];

export default function CoverageModal({
  open,
  onClose,
  onMatch,
}: {
  open: boolean;
  onClose: () => void;
  onMatch: () => void;
}) {
  const [picked, setPicked] = useState<Insurer | null>(null);

  useEffect(() => {
    if (!open) return;
    setPicked(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            className="fixed inset-0 bg-ink/60 backdrop-blur-sm z-[60]"
          />

          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="coverage-title"
            initial={{ opacity: 0, y: 20, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.96 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[61] w-[min(540px,calc(100vw-2rem))] max-h-[calc(100vh-2rem)] overflow-y-auto bg-white shadow-card"
            style={{ borderRadius: "24px 0 24px 24px" }}
          >
            {/* Header */}
            <div className="px-7 pt-6 pb-5 border-b border-surface-line flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <span
                  className="w-10 h-10 rounded-full grid place-items-center mt-0.5"
                  style={{ backgroundColor: "rgba(225,184,120,0.18)" }}
                >
                  <FiShield size={18} style={{ color: "#66202A" }} />
                </span>
                <div>
                  <span
                    className="text-[11px] font-semibold uppercase tracking-[0.18em]"
                    style={{ color: "#E1B878" }}
                  >
                    Insurance check
                  </span>
                  <h3 id="coverage-title" className="font-display text-2xl text-ink font-bold mt-0.5">
                    {picked ? "Your coverage estimate" : "Check your coverage"}
                  </h3>
                </div>
              </div>
              <button
                onClick={onClose}
                className="w-9 h-9 grid place-items-center rounded-full hover:bg-cream-alt text-ink-soft hover:text-ink transition shrink-0"
                aria-label="Close"
              >
                <FiX size={18} />
              </button>
            </div>

            {/* Body */}
            <div className="px-7 py-6">
              {!picked ? (
                <>
                  <p className="text-sm text-ink-soft leading-relaxed mb-5">
                    Pick your insurer. Most insured members pay <span className="font-semibold text-ink">$0–$40 / session</span>.
                  </p>
                  <ul className="grid gap-2">
                    {INSURERS.map((ins) => (
                      <li key={ins.id}>
                        <button
                          type="button"
                          onClick={() => setPicked(ins)}
                          className="w-full text-left flex items-center gap-3 p-3.5 transition hover:-translate-y-0.5 group"
                          style={{
                            backgroundColor: "#F4F4F4",
                            borderRadius: "14px 0 14px 14px",
                            border: "1.5px solid transparent",
                          }}
                        >
                          <span
                            className="w-8 h-8 rounded-full grid place-items-center text-xs font-bold shrink-0"
                            style={{
                              backgroundColor: "#fff",
                              color: "#66202A",
                            }}
                          >
                            {ins.name.slice(0, 1)}
                          </span>
                          <span className="flex-1 min-w-0">
                            <span className="block text-[15px] font-semibold text-ink truncate">{ins.name}</span>
                            <span className="block text-xs text-ink-soft mt-0.5">{ins.estimate}</span>
                          </span>
                          <FiArrowRight
                            size={14}
                            className="text-ink-soft group-hover:translate-x-0.5 transition"
                          />
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <CoverageResult ins={picked} onMatch={onMatch} onBack={() => setPicked(null)} />
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

function CoverageResult({
  ins,
  onMatch,
  onBack,
}: {
  ins: Insurer;
  onMatch: () => void;
  onBack: () => void;
}) {
  return (
    <div>
      <div
        className="p-5"
        style={{
          backgroundColor: "rgba(225,184,120,0.14)",
          borderRadius: "18px 0 18px 18px",
          border: "1px solid #E1B878",
        }}
      >
        <div className="flex items-center gap-2.5">
          <span
            className="w-9 h-9 rounded-full grid place-items-center shrink-0"
            style={{ backgroundColor: "#66202A" }}
          >
            <FiCheck size={18} className="text-white" />
          </span>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em]" style={{ color: "#66202A" }}>
              {ins.accepted ? "In-network" : "Verification needed"}
            </div>
            <div className="font-display text-lg font-bold text-ink leading-tight">{ins.name}</div>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-ink-soft font-semibold">
              Estimated copay
            </div>
            <div className="font-display text-2xl text-ink font-bold tabular mt-1">
              {ins.estimate}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-ink-soft font-semibold">
              Per session
            </div>
            <div className="font-display text-2xl text-ink font-bold tabular mt-1">
              50 min
            </div>
          </div>
        </div>
      </div>

      <ul className="mt-5 space-y-2 text-sm text-ink-soft">
        <li className="flex items-start gap-2">
          <FiCheck size={14} style={{ color: "#66202A" }} className="mt-0.5 shrink-0" />
          <span>Final cost confirmed after insurance verification.</span>
        </li>
        <li className="flex items-start gap-2">
          <FiCheck size={14} style={{ color: "#66202A" }} className="mt-0.5 shrink-0" />
          <span>Sliding-scale &amp; self-pay options if not covered.</span>
        </li>
        <li className="flex items-start gap-2">
          <FiCheck size={14} style={{ color: "#66202A" }} className="mt-0.5 shrink-0" />
          <span>No charge for the initial consultation call.</span>
        </li>
      </ul>

      <div className="mt-6 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className="text-sm font-semibold text-ink-soft hover:text-ink transition px-3 py-2"
        >
          Pick a different insurer
        </button>
        <button
          type="button"
          onClick={onMatch}
          className="btn-primary"
        >
          Match me with a therapist
        </button>
      </div>
    </div>
  );
}
