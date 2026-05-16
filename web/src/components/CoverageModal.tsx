"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  FiArrowLeft,
  FiArrowRight,
  FiAlertTriangle,
  FiCheck,
  FiShield,
  FiX,
  FiPhone,
  FiMail,
  FiUser,
  FiCalendar,
  FiHash,
} from "react-icons/fi";

type Payer = {
  id: string;
  name: string;
  special?: "self-pay" | "other";
};

const PAYERS: Payer[] = [
  { id: "aetna", name: "Aetna" },
  { id: "uhc", name: "UnitedHealthcare" },
  { id: "cigna", name: "Cigna" },
  { id: "anthem", name: "Anthem" },
  { id: "bcbs", name: "Blue Cross Blue Shield" },
  { id: "humana", name: "Humana" },
  { id: "kaiser", name: "Kaiser Permanente" },
  { id: "medicare", name: "Medicare" },
  { id: "medicaid", name: "Medicaid" },
  { id: "tricare", name: "Tricare" },
  { id: "molina", name: "Molina Healthcare" },
  { id: "oscar", name: "Oscar Health" },
  { id: "ambetter", name: "Ambetter" },
  { id: "self-pay", name: "Self-pay / Out-of-network", special: "self-pay" },
  { id: "other", name: "Other / not listed", special: "other" },
];

type CoverageStatus = "eligible" | "needs_review" | "ineligible" | "verification_error";

type CheckResponse = {
  ok: boolean;
  check_uuid: string;
  eligible: boolean;
  coverage_status: CoverageStatus;
  payer: string;
  plan?: string | null;
  copay?: string | null;
  message: string;
};

type FormState = {
  firstName: string;
  lastName: string;
  dob: string;
  memberId: string;
  email: string;
  phone: string;
};

const EMPTY_FORM: FormState = {
  firstName: "",
  lastName: "",
  dob: "",
  memberId: "",
  email: "",
  phone: "",
};

type Phase =
  | { kind: "pick-payer" }
  | { kind: "fill-form"; payer: Payer }
  | { kind: "self-pay-info"; payer: Payer }
  | { kind: "submitting"; payer: Payer }
  | { kind: "result"; payer: Payer; data: CheckResponse }
  | { kind: "error"; payer: Payer };

export default function CoverageModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: "pick-payer" });
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    setPhase({ kind: "pick-payer" });
    setForm(EMPTY_FORM);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  function pickPayer(p: Payer) {
    if (p.special === "self-pay" || p.special === "other") {
      setPhase({ kind: "self-pay-info", payer: p });
      return;
    }
    setPhase({ kind: "fill-form", payer: p });
  }

  const canSubmit =
    !!form.firstName.trim() &&
    !!form.lastName.trim() &&
    !!form.dob &&
    !!form.memberId.trim();

  async function submit(payer: Payer) {
    setPhase({ kind: "submitting", payer });
    try {
      const r = await fetch("/v1/coverage/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          first_name: form.firstName.trim(),
          last_name: form.lastName.trim(),
          date_of_birth: form.dob,
          payer_name: payer.name,
          member_id: form.memberId.trim(),
          email: form.email.trim() || undefined,
          phone: form.phone.trim() || undefined,
        }),
      });
      if (!r.ok) throw new Error(await r.text());
      const data = (await r.json()) as CheckResponse;
      setPhase({ kind: "result", payer, data });
    } catch {
      setPhase({ kind: "error", payer });
    }
  }

  if (!mounted) return null;

  const headerTitle =
    phase.kind === "pick-payer"
      ? "Check your coverage"
      : phase.kind === "self-pay-info"
        ? "Self-pay & manual verification"
        : phase.kind === "result"
          ? "Your coverage result"
          : "Verify your insurance";

  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            className="fixed inset-0 bg-ink/60 backdrop-blur-sm z-[60]"
          />

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            className="fixed inset-0 z-[61] overflow-y-auto p-4 sm:p-6"
          >
            <div className="flex min-h-full items-center justify-center">
              <motion.div
                role="dialog"
                aria-modal="true"
                aria-labelledby="coverage-title"
                initial={{ opacity: 0, y: 20, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 20, scale: 0.96 }}
                transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                onClick={(event) => event.stopPropagation()}
                className="relative my-auto w-full max-w-[560px] max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain bg-white shadow-card"
                style={{ borderRadius: "24px 0 24px 24px" }}
              >
                {/* Header */}
                <div className="px-5 sm:px-7 pt-6 pb-5 border-b border-surface-line flex items-start justify-between gap-4">
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
                      <h3
                        id="coverage-title"
                        className="font-display text-2xl text-ink font-bold mt-0.5"
                      >
                        {headerTitle}
                      </h3>
                    </div>
                  </div>
                  <button
                    onClick={onClose}
                    className="w-11 h-11 grid place-items-center rounded-full hover:bg-cream-alt text-ink-soft hover:text-ink transition shrink-0"
                    aria-label="Close"
                  >
                    <FiX size={18} />
                  </button>
                </div>

                {/* Body */}
                <div className="px-5 sm:px-7 py-6">
                  <AnimatePresence mode="wait" initial={false}>
                    <motion.div
                      key={phase.kind}
                      initial={{ opacity: 0, x: 16 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -16 }}
                      transition={{ duration: 0.22 }}
                    >
                      {phase.kind === "pick-payer" && (
                        <PickPayer onPick={pickPayer} />
                      )}

                      {phase.kind === "fill-form" && (
                        <FillForm
                          payer={phase.payer}
                          form={form}
                          setForm={setForm}
                          canSubmit={canSubmit}
                          submitting={false}
                          onBack={() => setPhase({ kind: "pick-payer" })}
                          onSubmit={() => submit(phase.payer)}
                        />
                      )}

                      {phase.kind === "submitting" && (
                        <FillForm
                          payer={phase.payer}
                          form={form}
                          setForm={setForm}
                          canSubmit={canSubmit}
                          submitting
                          onBack={() => setPhase({ kind: "pick-payer" })}
                          onSubmit={() => submit(phase.payer)}
                        />
                      )}

                      {phase.kind === "self-pay-info" && (
                        <SelfPayPanel
                          payer={phase.payer}
                          onBack={() => setPhase({ kind: "pick-payer" })}
                          onClose={onClose}
                        />
                      )}

                      {phase.kind === "result" && (
                        <ResultPanel
                          payer={phase.payer}
                          data={phase.data}
                          onClose={onClose}
                        />
                      )}

                      {phase.kind === "error" && (
                        <ErrorPanel
                          onRetry={() => submit(phase.payer)}
                          onBack={() =>
                            setPhase({ kind: "fill-form", payer: phase.payer })
                          }
                        />
                      )}
                    </motion.div>
                  </AnimatePresence>
                </div>
              </motion.div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}

function PickPayer({ onPick }: { onPick: (p: Payer) => void }) {
  return (
    <div>
      <p className="text-sm text-ink-soft leading-relaxed mb-5">
        Pick your insurance plan. We&rsquo;ll verify eligibility in real time
        through your payer&rsquo;s system.
      </p>
      <ul className="grid gap-2">
        {PAYERS.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              onClick={() => onPick(p)}
              className="w-full text-left flex items-center gap-3 p-3.5 transition hover:-translate-y-0.5 group"
              style={{
                backgroundColor: "#F4F4F4",
                borderRadius: "14px 0 14px 14px",
                border: "1.5px solid transparent",
              }}
            >
              <span
                className="w-8 h-8 rounded-full grid place-items-center text-xs font-bold shrink-0"
                style={{ backgroundColor: "#fff", color: "#66202A" }}
              >
                {p.name.slice(0, 1)}
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-[15px] font-semibold text-ink truncate">
                  {p.name}
                </span>
              </span>
              <FiArrowRight
                size={14}
                className="text-ink-soft group-hover:translate-x-0.5 transition"
              />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function FillForm({
  payer,
  form,
  setForm,
  canSubmit,
  submitting,
  onBack,
  onSubmit,
}: {
  payer: Payer;
  form: FormState;
  setForm: (f: FormState) => void;
  canSubmit: boolean;
  submitting: boolean;
  onBack: () => void;
  onSubmit: () => void;
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (canSubmit && !submitting) onSubmit();
      }}
    >
      <div
        className="mb-5 p-3.5 flex items-center gap-3"
        style={{
          backgroundColor: "rgba(225,184,120,0.14)",
          borderRadius: "14px 0 14px 14px",
          border: "1px solid rgba(225,184,120,0.6)",
        }}
      >
        <span
          className="w-8 h-8 rounded-full grid place-items-center text-xs font-bold shrink-0"
          style={{ backgroundColor: "#66202A", color: "#fff" }}
        >
          {payer.name.slice(0, 1)}
        </span>
        <div className="flex-1 min-w-0">
          <div
            className="text-[10px] uppercase tracking-[0.16em] font-semibold"
            style={{ color: "#66202A" }}
          >
            Verifying with
          </div>
          <div className="text-[15px] font-semibold text-ink truncate">
            {payer.name}
          </div>
        </div>
      </div>

      <p className="text-sm text-ink-soft leading-relaxed mb-4">
        Match the details exactly as they appear on your insurance card.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field
          label="First name"
          value={form.firstName}
          onChange={(v) => setForm({ ...form, firstName: v })}
          required
          icon={<FiUser size={14} />}
          autoComplete="given-name"
        />
        <Field
          label="Last name"
          value={form.lastName}
          onChange={(v) => setForm({ ...form, lastName: v })}
          required
          icon={<FiUser size={14} />}
          autoComplete="family-name"
        />
      </div>
      <div className="mt-3">
        <Field
          label="Date of birth"
          type="date"
          value={form.dob}
          onChange={(v) => setForm({ ...form, dob: v })}
          required
          icon={<FiCalendar size={14} />}
          autoComplete="bday"
        />
      </div>
      <div className="mt-3">
        <Field
          label="Member / Subscriber ID"
          value={form.memberId}
          onChange={(v) => setForm({ ...form, memberId: v })}
          required
          icon={<FiHash size={14} />}
          autoComplete="off"
        />
      </div>
      <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field
          label="Phone (optional)"
          type="tel"
          value={form.phone}
          onChange={(v) => setForm({ ...form, phone: v })}
          icon={<FiPhone size={14} />}
          autoComplete="tel"
        />
        <Field
          label="Email (optional)"
          type="email"
          value={form.email}
          onChange={(v) => setForm({ ...form, email: v })}
          icon={<FiMail size={14} />}
          autoComplete="email"
        />
      </div>

      <p className="text-[11px] text-ink-soft mt-4 leading-relaxed">
        Your information is transmitted over HIPAA-secure channels and used only
        to verify benefits.
      </p>

      <div className="mt-6 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          disabled={submitting}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-soft hover:text-ink disabled:opacity-30 transition px-3 py-2"
        >
          <FiArrowLeft size={14} /> Back
        </button>
        <button
          type="submit"
          disabled={!canSubmit || submitting}
          className="btn-primary disabled:opacity-50"
        >
          {submitting ? "Checking…" : "Check coverage"}
        </button>
      </div>
    </form>
  );
}

function SelfPayPanel({
  payer,
  onBack,
  onClose,
}: {
  payer: Payer;
  onBack: () => void;
  onClose: () => void;
}) {
  const isSelfPay = payer.special === "self-pay";
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
            <FiShield size={18} className="text-white" />
          </span>
          <div>
            <div
              className="text-[11px] font-semibold uppercase tracking-[0.16em]"
              style={{ color: "#66202A" }}
            >
              {isSelfPay ? "Self-pay options" : "Manual verification"}
            </div>
            <div className="font-display text-lg font-bold text-ink leading-tight">
              {payer.name}
            </div>
          </div>
        </div>
        <p className="mt-4 text-sm text-ink leading-relaxed">
          {isSelfPay
            ? "We offer competitive self-pay rates and sliding-scale options. Call us or use the chat and we'll walk you through pricing for your situation."
            : "We'll verify your plan manually. Please call us or use the chat and we'll confirm coverage with your insurer directly."}
        </p>
      </div>

      <ul className="mt-5 space-y-2 text-sm text-ink-soft">
        <li className="flex items-start gap-2">
          <FiPhone size={14} style={{ color: "#66202A" }} className="mt-0.5 shrink-0" />
          <span>
            Call us at{" "}
            <a
              href="tel:7252386990"
              className="font-semibold text-ink hover:underline"
            >
              725-238-6990
            </a>
          </span>
        </li>
        <li className="flex items-start gap-2">
          <FiCheck size={14} style={{ color: "#66202A" }} className="mt-0.5 shrink-0" />
          <span>No charge for the initial consultation call.</span>
        </li>
        <li className="flex items-start gap-2">
          <FiCheck size={14} style={{ color: "#66202A" }} className="mt-0.5 shrink-0" />
          <span>Sliding-scale options available based on need.</span>
        </li>
      </ul>

      <div className="mt-6 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-soft hover:text-ink transition px-3 py-2"
        >
          <FiArrowLeft size={14} /> Pick a different plan
        </button>
        <button type="button" onClick={onClose} className="btn-primary">
          Done
        </button>
      </div>
    </div>
  );
}

function ResultPanel({
  payer,
  data,
  onClose,
}: {
  payer: Payer;
  data: CheckResponse;
  onClose: () => void;
}) {
  const status = data.coverage_status;
  const isEligible = status === "eligible";
  const isError = status === "verification_error";
  const isNeedsReview = status === "needs_review" || status === "ineligible";

  const badgeLabel = isEligible
    ? "In-network — coverage confirmed"
    : isError
      ? "We'll verify manually"
      : "Manual verification needed";

  // Brand accent is wine. For non-eligible we use a softer amber border with
  // wine type — still on-brand, but visually distinct from a green check.
  const accent = isEligible
    ? { bg: "rgba(34,160,98,0.10)", border: "rgba(34,160,98,0.5)", chip: "#1f8a55", icon: "check" as const }
    : isError
      ? { bg: "rgba(225,184,120,0.18)", border: "#E1B878", chip: "#66202A", icon: "alert" as const }
      : { bg: "rgba(225,184,120,0.18)", border: "#E1B878", chip: "#66202A", icon: "alert" as const };

  return (
    <div>
      <div
        className="p-5"
        style={{
          backgroundColor: accent.bg,
          borderRadius: "18px 0 18px 18px",
          border: `1px solid ${accent.border}`,
        }}
      >
        <div className="flex items-center gap-2.5">
          <span
            className="w-9 h-9 rounded-full grid place-items-center shrink-0"
            style={{ backgroundColor: accent.chip }}
          >
            {accent.icon === "check" ? (
              <FiCheck size={18} className="text-white" />
            ) : (
              <FiAlertTriangle size={18} className="text-white" />
            )}
          </span>
          <div className="min-w-0">
            <div
              className="text-[11px] font-semibold uppercase tracking-[0.16em]"
              style={{ color: accent.chip }}
            >
              {badgeLabel}
            </div>
            <div className="font-display text-lg font-bold text-ink leading-tight truncate">
              {data.payer || payer.name}
            </div>
          </div>
        </div>

        {(data.plan || data.copay) && (
          <div className="mt-4 grid grid-cols-2 gap-3">
            {data.copay ? (
              <div>
                <div className="text-[10px] uppercase tracking-[0.18em] text-ink-soft font-semibold">
                  Estimated copay
                </div>
                <div className="font-display text-2xl text-ink font-bold tabular mt-1">
                  {data.copay}
                </div>
              </div>
            ) : null}
            {data.plan ? (
              <div>
                <div className="text-[10px] uppercase tracking-[0.18em] text-ink-soft font-semibold">
                  Plan
                </div>
                <div className="font-display text-lg text-ink font-bold mt-1 leading-tight">
                  {data.plan}
                </div>
              </div>
            ) : null}
          </div>
        )}

        <p className="mt-4 text-sm text-ink leading-relaxed whitespace-pre-line">
          {data.message}
        </p>
      </div>

      {!isEligible && (
        <p className="mt-4 text-xs text-ink-soft leading-relaxed">
          Questions? Call{" "}
          <a
            href="tel:7252386990"
            className="font-semibold text-ink hover:underline"
          >
            725-238-6990
          </a>{" "}
          and we&rsquo;ll sort out your benefits with you.
        </p>
      )}

      <div className="mt-6 flex items-center justify-end gap-3">
        <button type="button" onClick={onClose} className="btn-primary">
          Done
        </button>
      </div>
    </div>
  );
}

function ErrorPanel({
  onRetry,
  onBack,
}: {
  onRetry: () => void;
  onBack: () => void;
}) {
  return (
    <div>
      <div
        className="p-5"
        style={{
          backgroundColor: "rgba(225,184,120,0.18)",
          borderRadius: "18px 0 18px 18px",
          border: "1px solid #E1B878",
        }}
      >
        <div className="flex items-center gap-2.5">
          <span
            className="w-9 h-9 rounded-full grid place-items-center shrink-0"
            style={{ backgroundColor: "#66202A" }}
          >
            <FiAlertTriangle size={18} className="text-white" />
          </span>
          <div>
            <div
              className="text-[11px] font-semibold uppercase tracking-[0.16em]"
              style={{ color: "#66202A" }}
            >
              Connection issue
            </div>
            <div className="font-display text-lg font-bold text-ink leading-tight">
              We couldn&rsquo;t reach verification
            </div>
          </div>
        </div>
        <p className="mt-4 text-sm text-ink leading-relaxed">
          Something went wrong — please try again or call{" "}
          <a
            href="tel:7252386990"
            className="font-semibold hover:underline"
          >
            725-238-6990
          </a>
          .
        </p>
      </div>

      <div className="mt-6 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-soft hover:text-ink transition px-3 py-2"
        >
          <FiArrowLeft size={14} /> Edit details
        </button>
        <button type="button" onClick={onRetry} className="btn-primary">
          Try again
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  required,
  icon,
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  icon?: React.ReactNode;
  autoComplete?: string;
}) {
  return (
    <label className="block">
      <span className="block text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-soft mb-1.5">
        {label}
        {required && <span style={{ color: "#66202A" }}> *</span>}
      </span>
      <span className="relative block">
        {icon && (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-soft pointer-events-none">
            {icon}
          </span>
        )}
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required={required}
          autoComplete={autoComplete}
          className={`w-full bg-cream-alt border border-surface-line rounded-lg py-2.5 text-sm text-ink focus:outline-none focus:border-brand transition ${
            icon ? "pl-9 pr-3" : "px-3"
          }`}
        />
      </span>
    </label>
  );
}
