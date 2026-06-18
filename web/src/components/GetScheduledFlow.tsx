"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  FiArrowLeft,
  FiArrowRight,
  FiAlertTriangle,
  FiCheck,
  FiShield,
  FiPhone,
  FiMail,
  FiUser,
  FiCalendar,
  FiHash,
  FiLock,
} from "react-icons/fi";

// After verification (or skip), we hand off to Jane's booking system. Its first
// screen is the "Select a Location | Brighter Tomorrow Counseling Services"
// page, which is exactly step 2 of this flow.
const JANE_URL = "https://brightertomorrow.janeapp.com/";

type Payer = {
  id: string;
  name: string;
  special?: "self-pay" | "other";
};

const PAYERS: Payer[] = [
  { id: "aetna", name: "Aetna" },
  { id: "uhc", name: "UnitedHealthcare" },
  { id: "umr", name: "UMR" },
  { id: "cigna", name: "Cigna" },
  { id: "anthem", name: "Anthem" },
  { id: "bcbs", name: "Blue Cross Blue Shield" },
  { id: "humana", name: "Humana" },
  { id: "medicare", name: "Medicare" },
  { id: "tricare", name: "Tricare" },
  { id: "ambetter", name: "Ambetter" },
  { id: "self-pay", name: "Self-pay / Out-of-network", special: "self-pay" },
  { id: "other", name: "Other / not listed", special: "other" },
];

// `coverage_status` carries the RAW payer status the gateway passes through
// (e.g. "active", "inactive") — NOT a fixed enum. The only value the gateway
// sets itself is "verification_error". The authoritative eligibility signal is
// the `eligible` boolean, so the UI keys its result state on that, not on the
// free-form status string.
type CheckResponse = {
  ok: boolean;
  check_uuid: string;
  eligible: boolean;
  coverage_status: string;
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

/** Full-page handoff to Jane's "Select a Location" booking screen. */
function goToLocationSelect() {
  window.location.href = JANE_URL;
}

export default function GetScheduledFlow() {
  const [phase, setPhase] = useState<Phase>({ kind: "pick-payer" });
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

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

  const stepIndex =
    phase.kind === "result" || phase.kind === "self-pay-info" ? 1 : 0;

  return (
    <section className="bg-cream">
      <div className="container-x py-10 sm:py-14 lg:py-16">
        <div className="grid lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] gap-8 lg:gap-12 items-start">
          {/* ───── Left rail: reassurance + steps ───── */}
          <aside className="lg:sticky lg:top-28">
            <span
              className="text-[11px] font-semibold uppercase tracking-[0.2em]"
              style={{ color: "#E1B878" }}
            >
              Get scheduled
            </span>
            <h1 className="font-display text-3xl sm:text-4xl font-bold text-ink leading-[1.1] mt-2">
              Let&rsquo;s confirm your coverage, then pick your spot.
            </h1>
            <p className="text-ink-soft leading-relaxed mt-4 max-w-md">
              A quick, real-time insurance check now means no billing surprises
              later. It takes about a minute &mdash; then we&rsquo;ll take you
              straight to booking.
            </p>

            <ol className="mt-8 space-y-3">
              <StepRow
                n={1}
                active={stepIndex === 0}
                done={stepIndex > 0}
                label="Verify insurance"
                icon={<FiShield size={15} />}
              />
              <StepRow
                n={2}
                active={stepIndex === 1}
                done={false}
                label="Book the appointment"
                icon={<FiCalendar size={15} />}
              />
            </ol>

            <div
              className="mt-8 flex items-start gap-2.5 p-3.5 max-w-md"
              style={{
                backgroundColor: "rgba(225,184,120,0.12)",
                borderRadius: "14px 0 14px 14px",
                border: "1px solid rgba(225,184,120,0.5)",
              }}
            >
              <FiLock size={15} style={{ color: "#66202A" }} className="mt-0.5 shrink-0" />
              <p className="text-[12.5px] text-ink-soft leading-relaxed">
                Your details are transmitted over HIPAA-secure channels and used
                only to verify benefits.
              </p>
            </div>

            <p className="mt-5 text-sm text-ink-soft">
              Prefer to talk it through? Call{" "}
              <a href="tel:7252386990" className="font-semibold text-ink hover:underline">
                725-238-6990
              </a>
              .
            </p>
          </aside>

          {/* ───── Right: verification card ───── */}
          <div
            className="bg-white shadow-card overflow-hidden"
            style={{ borderRadius: "24px 0 24px 24px" }}
          >
            <div className="px-5 sm:px-8 pt-7 pb-5 border-b border-surface-line flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <span
                  className="w-10 h-10 rounded-full grid place-items-center"
                  style={{ backgroundColor: "rgba(225,184,120,0.18)" }}
                >
                  <FiShield size={18} style={{ color: "#66202A" }} />
                </span>
                <div>
                  <span
                    className="text-[11px] font-semibold uppercase tracking-[0.18em]"
                    style={{ color: "#E1B878" }}
                  >
                    Step 1 of 2 · Insurance check
                  </span>
                  <h2 className="font-display text-2xl text-ink font-bold mt-0.5">
                    {phase.kind === "pick-payer"
                      ? "Check your coverage"
                      : phase.kind === "self-pay-info"
                        ? "Self-pay & manual verification"
                        : phase.kind === "result"
                          ? "Your coverage result"
                          : "Verify your insurance"}
                  </h2>
                </div>
              </div>
            </div>

            <div className="px-5 sm:px-8 py-7">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={phase.kind}
                  initial={{ opacity: 0, x: 16 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -16 }}
                  transition={{ duration: 0.22 }}
                >
                  {phase.kind === "pick-payer" && (
                    <PickPayer onPick={pickPayer} onSkip={goToLocationSelect} />
                  )}

                  {phase.kind === "fill-form" && (
                    <FillForm
                      payer={phase.payer}
                      form={form}
                      setForm={setForm}
                      canSubmit={canSubmit}
                      onBack={() => setPhase({ kind: "pick-payer" })}
                      onSubmit={() => submit(phase.payer)}
                      onSkip={goToLocationSelect}
                    />
                  )}

                  {phase.kind === "submitting" && (
                    <CheckingPanel payer={phase.payer} />
                  )}

                  {phase.kind === "self-pay-info" && (
                    <SelfPayPanel
                      payer={phase.payer}
                      onBack={() => setPhase({ kind: "pick-payer" })}
                      onContinue={goToLocationSelect}
                    />
                  )}

                  {phase.kind === "result" && (
                    <ResultPanel
                      payer={phase.payer}
                      data={phase.data}
                      onBack={() => setPhase({ kind: "pick-payer" })}
                      onContinue={goToLocationSelect}
                    />
                  )}

                  {phase.kind === "error" && (
                    <ErrorPanel
                      onRetry={() => submit(phase.payer)}
                      onBack={() => setPhase({ kind: "fill-form", payer: phase.payer })}
                      onContinue={goToLocationSelect}
                    />
                  )}
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function StepRow({
  n,
  active,
  done,
  label,
  icon,
}: {
  n: number;
  active: boolean;
  done: boolean;
  label: string;
  icon: React.ReactNode;
}) {
  return (
    <li className="flex items-center gap-3">
      <span
        className="w-9 h-9 rounded-full grid place-items-center shrink-0 transition"
        style={{
          backgroundColor: done || active ? "#66202A" : "#fff",
          color: done || active ? "#fff" : "#66202A",
          border: `1.5px solid ${done || active ? "#66202A" : "#D9D9D9"}`,
        }}
      >
        {done ? <FiCheck size={15} /> : icon}
      </span>
      <span
        className={`text-[15px] font-semibold transition ${
          active ? "text-ink" : done ? "text-ink/70" : "text-ink-soft"
        }`}
      >
        {label}
      </span>
    </li>
  );
}

function PickPayer({
  onPick,
  onSkip,
}: {
  onPick: (p: Payer) => void;
  onSkip: () => void;
}) {
  return (
    <div>
      <p className="text-sm text-ink-soft leading-relaxed mb-3">
        Pick your insurance plan. We&rsquo;ll verify eligibility in real time
        through your payer&rsquo;s system.
      </p>
      <p className="mb-5 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-[13px] leading-snug text-amber-900">
        We accept most major insurances. Please note we are unable to accept{" "}
        <strong>Medicaid</strong> plans at this time &mdash; self-pay /
        out-of-network options are available.
      </p>
      <ul className="grid sm:grid-cols-2 gap-2">
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

      <div className="mt-6 pt-5 border-t border-surface-line flex items-center justify-between gap-3 flex-wrap">
        <p className="text-[13px] text-ink-soft">
          Already know your details, or paying out of pocket?
        </p>
        <button
          type="button"
          onClick={onSkip}
          className="inline-flex items-center gap-1.5 text-sm font-semibold hover:underline"
          style={{ color: "#66202A" }}
        >
          Skip &amp; book appointment <FiArrowRight size={14} />
        </button>
      </div>
    </div>
  );
}

function CheckingPanel({ payer }: { payer: Payer }) {
  return (
    <div className="py-12 flex flex-col items-center text-center">
      <span className="relative w-14 h-14 grid place-items-center">
        <span className="absolute inset-0 rounded-full border-2 border-surface-line" />
        <span
          className="absolute inset-0 rounded-full border-2 border-transparent animate-spin"
          style={{ borderTopColor: "#66202A" }}
        />
        <FiShield size={20} style={{ color: "#66202A" }} />
      </span>
      <h3 className="font-display text-xl font-bold text-ink mt-5">
        Checking your coverage…
      </h3>
      <p className="text-sm text-ink-soft mt-1.5 max-w-xs leading-relaxed">
        Verifying your benefits with {payer.name} in real time. This usually
        takes just a few seconds.
      </p>
    </div>
  );
}

function FillForm({
  payer,
  form,
  setForm,
  canSubmit,
  onBack,
  onSubmit,
  onSkip,
}: {
  payer: Payer;
  form: FormState;
  setForm: (f: FormState) => void;
  canSubmit: boolean;
  onBack: () => void;
  onSubmit: () => void;
  onSkip: () => void;
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (canSubmit) onSubmit();
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
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-soft hover:text-ink transition px-3 py-2"
        >
          <FiArrowLeft size={14} /> Back
        </button>
        <button
          type="submit"
          disabled={!canSubmit}
          className="btn-primary disabled:opacity-50"
        >
          Check coverage
        </button>
      </div>

      <div className="mt-3 text-center">
        <button
          type="button"
          onClick={onSkip}
          className="text-[13px] text-ink-soft hover:text-ink hover:underline transition"
        >
          Skip and book the appointment instead
        </button>
      </div>
    </form>
  );
}

function SelfPayPanel({
  payer,
  onBack,
  onContinue,
}: {
  payer: Payer;
  onBack: () => void;
  onContinue: () => void;
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
            ? "We offer competitive self-pay rates and sliding-scale options. You can book now and we'll walk you through pricing for your situation, or call us first."
            : "We'll verify your plan manually. You can book now and we'll confirm coverage with your insurer directly before your visit, or call us first."}
        </p>
      </div>

      <ul className="mt-5 space-y-2 text-sm text-ink-soft">
        <li className="flex items-start gap-2">
          <FiPhone size={14} style={{ color: "#66202A" }} className="mt-0.5 shrink-0" />
          <span>
            Call us at{" "}
            <a href="tel:7252386990" className="font-semibold text-ink hover:underline">
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
        <button type="button" onClick={onContinue} className="btn-primary">
          Continue — book appointment <FiArrowRight size={14} className="ml-1.5 inline" />
        </button>
      </div>
    </div>
  );
}

function ResultPanel({
  payer,
  data,
  onBack,
  onContinue,
}: {
  payer: Payer;
  data: CheckResponse;
  onBack: () => void;
  onContinue: () => void;
}) {
  const isError = data.coverage_status === "verification_error";
  // Trust the authoritative `eligible` boolean — the raw status can be "active",
  // "in force", etc., none of which equal the literal "eligible".
  const isEligible = !isError && data.eligible === true;

  const badgeLabel = isEligible
    ? "In-network — coverage confirmed"
    : isError
      ? "We'll verify manually"
      : "Manual verification needed";

  // Brand accent is wine. For non-eligible we use a softer amber border with
  // wine type — still on-brand, but visually distinct from a green check.
  const accent = isEligible
    ? { bg: "rgba(34,160,98,0.10)", border: "rgba(34,160,98,0.5)", chip: "#1f8a55", icon: "check" as const }
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
          You can still book now — we&rsquo;ll sort out your benefits before your
          visit. Questions? Call{" "}
          <a href="tel:7252386990" className="font-semibold text-ink hover:underline">
            725-238-6990
          </a>
          .
        </p>
      )}

      <div className="mt-6 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-soft hover:text-ink transition px-3 py-2"
        >
          <FiArrowLeft size={14} /> Check another plan
        </button>
        <button type="button" onClick={onContinue} className="btn-primary">
          Continue — book appointment <FiArrowRight size={14} className="ml-1.5 inline" />
        </button>
      </div>
    </div>
  );
}

function ErrorPanel({
  onRetry,
  onBack,
  onContinue,
}: {
  onRetry: () => void;
  onBack: () => void;
  onContinue: () => void;
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
          Something went wrong — please try again, continue to booking, or call{" "}
          <a href="tel:7252386990" className="font-semibold hover:underline">
            725-238-6990
          </a>
          .
        </p>
      </div>

      <div className="mt-6 flex items-center justify-between gap-3 flex-wrap">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-soft hover:text-ink transition px-3 py-2"
        >
          <FiArrowLeft size={14} /> Edit details
        </button>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onContinue}
            className="text-sm font-semibold hover:underline"
            style={{ color: "#66202A" }}
          >
            Continue anyway
          </button>
          <button type="button" onClick={onRetry} className="btn-primary">
            Try again
          </button>
        </div>
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
