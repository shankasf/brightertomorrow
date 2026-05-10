"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  FiArrowLeft, FiArrowRight, FiCheck, FiX, FiUser, FiUsers,
  FiHeart, FiHome, FiMonitor, FiShuffle, FiPhone, FiMail,
} from "react-icons/fi";

type Audience = "me" | "couple" | "child" | "family";
type Modality = "in-person" | "telehealth" | "either";

const FOCUS_OPTIONS = [
  "Anxiety",
  "Depression",
  "Trauma / PTSD",
  "Relationships",
  "Grief",
  "Life transitions",
  "LGBTQIA+ affirming",
  "Child & teen",
  "Couples",
  "Geriatric",
];

type Lead = {
  audience: Audience | "";
  focus: string[];
  modality: Modality | "";
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
};

const EMPTY: Lead = {
  audience: "",
  focus: [],
  modality: "",
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
};

export default function MatchModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [step, setStep] = useState(0);
  const [lead, setLead] = useState<Lead>(EMPTY);
  const [submitState, setSubmitState] = useState<"idle" | "sending" | "ok" | "err">("idle");

  useEffect(() => {
    if (!open) return;
    setStep(0);
    setLead(EMPTY);
    setSubmitState("idle");
  }, [open]);

  // Lock background scroll while open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  const totalSteps = 4;
  const canAdvance =
    step === 0 ? !!lead.audience :
    step === 1 ? lead.focus.length > 0 :
    step === 2 ? !!lead.modality :
    step === 3 ? !!lead.firstName && !!lead.email :
    false;

  async function submit() {
    setSubmitState("sending");
    try {
      const r = await fetch("/v1/contact", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          source: "hero-match-modal",
          first_name: lead.firstName,
          last_name: lead.lastName,
          email: lead.email,
          phone: lead.phone,
          message: `Match request — for: ${lead.audience}, focus: ${lead.focus.join(", ")}, modality: ${lead.modality}`,
        }),
      });
      if (!r.ok) throw new Error(await r.text());
      setSubmitState("ok");
    } catch {
      setSubmitState("err");
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            className="fixed inset-0 bg-ink/60 backdrop-blur-sm z-[60]"
          />

          {/* Dialog */}
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="match-title"
            initial={{ opacity: 0, y: 20, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.96 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[61] w-[min(560px,calc(100vw-2rem))] max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain bg-white shadow-card"
            style={{ borderRadius: "24px 0 24px 24px" }}
          >
            {/* Header */}
            <div className="px-7 pt-6 pb-5 border-b border-surface-line flex items-start justify-between gap-4">
              <div>
                <span
                  className="text-[11px] font-semibold uppercase tracking-[0.18em]"
                  style={{ color: "#E1B878" }}
                >
                  Find your therapist
                </span>
                <h3 id="match-title" className="font-display text-2xl text-ink mt-1 font-bold">
                  Let&rsquo;s get you matched
                </h3>
              </div>
              <button
                onClick={onClose}
                className="w-9 h-9 grid place-items-center rounded-full hover:bg-cream-alt text-ink-soft hover:text-ink transition shrink-0"
                aria-label="Close"
              >
                <FiX size={18} />
              </button>
            </div>

            {/* Progress dots */}
            {submitState !== "ok" && (
              <div className="px-7 pt-5">
                <div className="flex items-center gap-1.5">
                  {Array.from({ length: totalSteps }).map((_, i) => (
                    <span
                      key={i}
                      className="h-1.5 flex-1 rounded-full transition-all duration-300"
                      style={{
                        backgroundColor: i <= step ? "#E1B878" : "#E5E5E5",
                      }}
                    />
                  ))}
                </div>
                <div className="text-[11px] text-ink-soft mt-2 tabular-nums">
                  Step {step + 1} of {totalSteps}
                </div>
              </div>
            )}

            {/* Body */}
            <div className="px-7 py-6 min-h-[260px]">
              {submitState === "ok" ? (
                <SuccessPanel onClose={onClose} />
              ) : (
                <AnimatePresence mode="wait" initial={false}>
                  <motion.div
                    key={step}
                    initial={{ opacity: 0, x: 16 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -16 }}
                    transition={{ duration: 0.25 }}
                  >
                    {step === 0 && (
                      <Step heading="Who is therapy for?">
                        <div className="grid grid-cols-2 gap-3">
                          <ChoiceCard
                            icon={<FiUser />}
                            label="Myself"
                            active={lead.audience === "me"}
                            onClick={() => setLead({ ...lead, audience: "me" })}
                          />
                          <ChoiceCard
                            icon={<FiHeart />}
                            label="Couple"
                            active={lead.audience === "couple"}
                            onClick={() => setLead({ ...lead, audience: "couple" })}
                          />
                          <ChoiceCard
                            icon={<FiUsers />}
                            label="Child or teen"
                            active={lead.audience === "child"}
                            onClick={() => setLead({ ...lead, audience: "child" })}
                          />
                          <ChoiceCard
                            icon={<FiUsers />}
                            label="Family"
                            active={lead.audience === "family"}
                            onClick={() => setLead({ ...lead, audience: "family" })}
                          />
                        </div>
                      </Step>
                    )}

                    {step === 1 && (
                      <Step
                        heading="What are you looking for help with?"
                        sub="Pick all that apply."
                      >
                        <div className="flex flex-wrap gap-2">
                          {FOCUS_OPTIONS.map((opt) => {
                            const selected = lead.focus.includes(opt);
                            return (
                              <button
                                key={opt}
                                type="button"
                                onClick={() =>
                                  setLead({
                                    ...lead,
                                    focus: selected
                                      ? lead.focus.filter((f) => f !== opt)
                                      : [...lead.focus, opt],
                                  })
                                }
                                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium border transition"
                                style={{
                                  backgroundColor: selected ? "#66202A" : "#F4F4F4",
                                  color: selected ? "#fff" : "#192735",
                                  borderColor: selected ? "#66202A" : "#D9D9D9",
                                }}
                              >
                                {selected && <FiCheck size={13} />}
                                {opt}
                              </button>
                            );
                          })}
                        </div>
                      </Step>
                    )}

                    {step === 2 && (
                      <Step heading="How would you prefer to meet?">
                        <div className="grid gap-3">
                          <ChoiceCard
                            icon={<FiHome />}
                            label="In-person"
                            sub="Las Vegas — E Russell or N Durango office"
                            active={lead.modality === "in-person"}
                            onClick={() => setLead({ ...lead, modality: "in-person" })}
                          />
                          <ChoiceCard
                            icon={<FiMonitor />}
                            label="Telehealth"
                            sub="Anywhere in Nevada — secure video sessions"
                            active={lead.modality === "telehealth"}
                            onClick={() => setLead({ ...lead, modality: "telehealth" })}
                          />
                          <ChoiceCard
                            icon={<FiShuffle />}
                            label="Either is fine"
                            active={lead.modality === "either"}
                            onClick={() => setLead({ ...lead, modality: "either" })}
                          />
                        </div>
                      </Step>
                    )}

                    {step === 3 && (
                      <Step
                        heading="Where can we reach you?"
                        sub="We'll match you within one business day."
                      >
                        <div className="grid grid-cols-2 gap-3">
                          <Field
                            label="First name"
                            value={lead.firstName}
                            onChange={(v) => setLead({ ...lead, firstName: v })}
                            required
                          />
                          <Field
                            label="Last name"
                            value={lead.lastName}
                            onChange={(v) => setLead({ ...lead, lastName: v })}
                          />
                        </div>
                        <div className="mt-3">
                          <Field
                            label="Email"
                            type="email"
                            value={lead.email}
                            onChange={(v) => setLead({ ...lead, email: v })}
                            required
                            icon={<FiMail size={14} />}
                          />
                        </div>
                        <div className="mt-3">
                          <Field
                            label="Phone (optional)"
                            type="tel"
                            value={lead.phone}
                            onChange={(v) => setLead({ ...lead, phone: v })}
                            icon={<FiPhone size={14} />}
                          />
                        </div>
                      </Step>
                    )}
                  </motion.div>
                </AnimatePresence>
              )}
            </div>

            {/* Footer */}
            {submitState !== "ok" && (
              <div className="px-7 pb-6 pt-2 flex items-center justify-between gap-3 border-t border-surface-line">
                <button
                  type="button"
                  onClick={() => setStep((s) => Math.max(0, s - 1))}
                  disabled={step === 0}
                  className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-soft hover:text-ink disabled:opacity-30 transition px-3 py-2"
                >
                  <FiArrowLeft size={14} /> Back
                </button>

                {step < totalSteps - 1 ? (
                  <button
                    type="button"
                    onClick={() => canAdvance && setStep((s) => s + 1)}
                    disabled={!canAdvance}
                    className="inline-flex items-center gap-2 text-white font-semibold uppercase tracking-[0.12em] text-[0.78rem] px-6 py-3 transition disabled:opacity-50"
                    style={{
                      backgroundColor: "#66202A",
                      borderRadius: "20px 0 20px 20px",
                    }}
                  >
                    Continue <FiArrowRight size={14} />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => canAdvance && submitState !== "sending" && void submit()}
                    disabled={!canAdvance || submitState === "sending"}
                    className="btn-primary disabled:opacity-50"
                  >
                    {submitState === "sending" ? "Sending…" : "Match me"}
                  </button>
                )}
              </div>
            )}

            {submitState === "err" && (
              <div className="px-7 pb-5 -mt-2">
                <p className="text-sm text-red-700">
                  Something went wrong. Please try again or call 725-238-6990.
                </p>
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

function Step({
  heading,
  sub,
  children,
}: {
  heading: string;
  sub?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h4 className="font-display text-[1.25rem] text-ink font-bold leading-tight">
        {heading}
      </h4>
      {sub && <p className="text-sm text-ink-soft mt-1">{sub}</p>}
      <div className="mt-5">{children}</div>
    </div>
  );
}

function ChoiceCard({
  icon,
  label,
  sub,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  sub?: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-left p-4 transition flex items-start gap-3"
      style={{
        backgroundColor: active ? "rgba(225,184,120,0.18)" : "#F4F4F4",
        borderRadius: "16px 0 16px 16px",
        border: `1.5px solid ${active ? "#E1B878" : "transparent"}`,
      }}
    >
      <span
        className="w-9 h-9 grid place-items-center rounded-full shrink-0"
        style={{ backgroundColor: active ? "#66202A" : "#fff", color: active ? "#fff" : "#66202A" }}
      >
        {icon}
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-[15px] font-semibold text-ink">{label}</span>
        {sub && <span className="block text-xs text-ink-soft mt-0.5">{sub}</span>}
      </span>
      {active && <FiCheck size={16} style={{ color: "#66202A" }} />}
    </button>
  );
}

function Field({
  label, value, onChange, type = "text", required, icon,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  icon?: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-soft mb-1.5">
        {label}{required && <span style={{ color: "#66202A" }}> *</span>}
      </span>
      <span className="relative block">
        {icon && (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-soft">
            {icon}
          </span>
        )}
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required={required}
          className={`w-full bg-cream-alt border border-surface-line rounded-lg py-2.5 text-sm text-ink focus:outline-none focus:border-brand transition ${
            icon ? "pl-9 pr-3" : "px-3"
          }`}
        />
      </span>
    </label>
  );
}

function SuccessPanel({ onClose }: { onClose: () => void }) {
  return (
    <div className="text-center py-6">
      <div
        className="mx-auto w-14 h-14 rounded-full grid place-items-center mb-4"
        style={{ backgroundColor: "rgba(225,184,120,0.2)" }}
      >
        <FiCheck size={26} style={{ color: "#66202A" }} />
      </div>
      <h4 className="font-display text-2xl text-ink font-bold">You&rsquo;re in good hands.</h4>
      <p className="text-sm text-ink-soft mt-2 max-w-sm mx-auto leading-relaxed">
        We&rsquo;ll review your answers and email you a therapist match within
        one business day. Watch your inbox.
      </p>
      <button
        type="button"
        onClick={onClose}
        className="btn-primary mt-6"
      >
        Done
      </button>
    </div>
  );
}
