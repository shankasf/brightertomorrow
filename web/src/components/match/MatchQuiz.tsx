"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { FiArrowLeft, FiArrowRight, FiCheck } from "react-icons/fi";
import { buildFlow } from "./api";
import type { MatchAnswers, MatchConfig } from "./types";

const WINE = "#66202A";
const GOLD = "#E1B878";

/**
 * The full-page match stepper — ported from therapist-match.html into the site
 * design system (wine/cream, asymmetric corners). Progress dots, option cards,
 * back/continue. Drives off the data-driven MatchConfig and calls onComplete
 * with the collected non-PHI answers.
 */
export default function MatchQuiz({
  config,
  onComplete,
  onSkip,
  initialAnswers,
}: {
  config: MatchConfig;
  onComplete: (answers: MatchAnswers) => void;
  onSkip?: () => void;
  initialAnswers?: MatchAnswers;
}) {
  const reduce = useReducedMotion();
  const [answers, setAnswers] = useState<MatchAnswers>(initialAnswers ?? {});
  const [step, setStep] = useState(0);

  const flow = useMemo(() => buildFlow(config, answers), [config, answers]);
  // Flow can shrink (e.g. switching modality away from in-person drops the
  // location step) — clamp so we never index past the end.
  const idx = Math.min(step, flow.length - 1);
  const current = flow[idx];
  const selected = current ? answers[current.id as keyof MatchAnswers] : undefined;

  if (!current) return null;

  const select = (value: string) => {
    setAnswers((prev) => {
      const next = { ...prev, [current.id]: value };
      // Clearing a now-irrelevant location keeps the answer payload honest.
      if (current.id === "modality" && value !== "in-person") delete next.location;
      return next;
    });
  };

  const goNext = () => {
    if (!selected) return;
    if (idx < flow.length - 1) setStep(idx + 1);
    else onComplete(answers);
  };

  const goBack = () => {
    if (idx > 0) setStep(idx - 1);
  };

  const xShift = reduce ? 0 : 16;

  return (
    <div>
      {/* Progress dots */}
      <div className="mb-6 flex gap-1.5" aria-hidden>
        {flow.map((q, i) => (
          <span
            key={q.id}
            className="h-1 flex-1 rounded-full transition-colors"
            style={{
              backgroundColor: i < idx ? GOLD : i === idx ? WINE : "#e8d8c8",
            }}
          />
        ))}
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={current.id}
          initial={{ opacity: 0, x: xShift }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -xShift }}
          transition={{ duration: 0.22 }}
        >
          <div
            className="text-[11px] font-semibold uppercase tracking-[0.16em] mb-1.5"
            style={{ color: GOLD }}
          >
            Step {idx + 1} of {flow.length}
          </div>
          <h2 className="font-display text-2xl font-bold text-ink leading-tight">
            {current.question}
          </h2>
          {current.sub && <p className="text-sm text-ink-soft mt-1.5 mb-5">{current.sub}</p>}

          <div
            role="radiogroup"
            aria-label={current.question}
            className="grid gap-2.5"
          >
            {current.options.map((opt) => {
              const isSel = selected === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="radio"
                  aria-checked={isSel}
                  onClick={() => select(opt.value)}
                  className="flex items-center gap-3.5 p-3.5 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                  style={{
                    borderRadius: "14px 0 14px 14px",
                    border: `1.5px solid ${isSel ? WINE : "#e8d8c8"}`,
                    backgroundColor: isSel ? "#fdf0f2" : "#fff",
                  }}
                >
                  {opt.icon && (
                    <span
                      className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-lg"
                      style={{ backgroundColor: "#F5EBDD" }}
                      aria-hidden
                    >
                      {opt.icon}
                    </span>
                  )}
                  <span className="flex-1 min-w-0">
                    <span className="block text-[15px] font-semibold text-ink">{opt.label}</span>
                    {opt.desc && (
                      <span className="block text-[13px] text-ink-soft mt-0.5">{opt.desc}</span>
                    )}
                  </span>
                  <span
                    className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full transition"
                    style={{
                      border: `1.5px solid ${isSel ? WINE : "#d0c0b0"}`,
                      backgroundColor: isSel ? WINE : "transparent",
                    }}
                    aria-hidden
                  >
                    {isSel && <FiCheck size={13} className="text-white" />}
                  </span>
                </button>
              );
            })}
          </div>
        </motion.div>
      </AnimatePresence>

      <div className="mt-7 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={goBack}
          className={`inline-flex items-center gap-1.5 text-sm font-semibold text-ink-soft transition hover:text-ink px-1 py-2 ${
            idx === 0 ? "invisible" : ""
          }`}
        >
          <FiArrowLeft size={14} /> Back
        </button>
        <button
          type="button"
          onClick={goNext}
          disabled={!selected}
          className="inline-flex items-center gap-1.5 rounded-lg px-7 py-3 text-[15px] font-semibold text-white transition hover:opacity-90 disabled:opacity-30 disabled:cursor-default"
          style={{ backgroundColor: WINE, borderRadius: "12px 0 12px 12px" }}
        >
          {idx < flow.length - 1 ? "Continue" : "See my matches"}
          <FiArrowRight size={14} />
        </button>
      </div>

      {onSkip && (
        <div className="mt-3 text-center">
          <button
            type="button"
            onClick={onSkip}
            className="text-[13px] text-ink-soft transition hover:text-ink hover:underline"
          >
            Skip the quiz and book directly
          </button>
        </div>
      )}
    </div>
  );
}
