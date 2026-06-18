"use client";

import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  FiArrowLeft,
  FiArrowRight,
  FiCheck,
  FiAlertTriangle,
  FiShield,
  FiUser,
  FiUsers,
  FiHeart,
  FiHome,
  FiMonitor,
  FiShuffle,
  FiPhone,
  FiMail,
  FiMapPin,
  FiHash,
  FiCalendar,
  FiDollarSign,
  FiCreditCard,
  FiEdit2,
} from "react-icons/fi";

// =====================================================================
// Reference data
// =====================================================================

type Payer = { id: string; name: string };

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
];

const SERVICE_OPTIONS = [
  "Anxiety",
  "Depression",
  "Trauma / PTSD",
  "Relationships / Couples",
  "Grief & loss",
  "Life transitions",
  "LGBTQIA+ affirming",
  "Child & teen",
  "Family therapy",
  "Stress / Burnout",
];

const SEX_OPTIONS = ["Female", "Male", "Non-binary", "Other"];

const RELATIONSHIP_OPTIONS = ["Self", "Spouse", "Parent", "Child", "Other"];

const MODALITY_OPTIONS: { id: "in-person" | "telehealth" | "either"; label: string; sub: string; icon: React.ReactNode }[] = [
  { id: "in-person", label: "In-person", sub: "Las Vegas — E Russell or N Durango", icon: <FiHome /> },
  { id: "telehealth", label: "Telehealth", sub: "Secure video, anywhere in Nevada", icon: <FiMonitor /> },
  { id: "either", label: "Either is fine", sub: "We'll work it out together", icon: <FiShuffle /> },
];

// =====================================================================
// Types
// =====================================================================

type PaymentMethod = "insurance" | "self_pay";

type CoverageResponse = {
  ok: boolean;
  check_uuid: string;
  eligible: boolean;
  coverage_status: string;
  payer: string;
  plan?: string | null;
  copay?: string | null;
  message: string;
};

type IntakeResponse = {
  ok: boolean;
  submission_uuid: string;
  eligible: boolean;
  coverage_status: string;
  coverage?: Record<string, unknown>;
  next_step: string;
};

type FormState = {
  // Step: service + payment
  service: string;
  serviceOther: string;
  paymentMethod: PaymentMethod | "";
  modality: "in-person" | "telehealth" | "either" | "";
  // Step: identity
  firstName: string;
  lastName: string;
  dob: string;
  // Step: insurance check
  payerName: string;
  memberId: string;
  // Step: contact
  phone: string;
  email: string;
  homeAddress: string;
  sex: string;
  // Step: subscriber (insurance only)
  subscriberName: string;
  subscriberRelationship: string;
  // Optional notes
  notes: string;
  // SMS opt-ins (optional, unchecked by default). Appointment and marketing
  // consent are collected separately per A2P/10DLC requirements.
  smsConsent: boolean;
  smsMarketingConsent: boolean;
};

const EMPTY_FORM: FormState = {
  service: "",
  serviceOther: "",
  paymentMethod: "",
  modality: "",
  firstName: "",
  lastName: "",
  dob: "",
  payerName: "",
  memberId: "",
  phone: "",
  email: "",
  homeAddress: "",
  sex: "",
  subscriberName: "",
  subscriberRelationship: "",
  notes: "",
  smsConsent: false,
  smsMarketingConsent: false,
};

// =====================================================================
// Step plumbing
// =====================================================================

type StepId =
  | "service"
  | "identity"
  | "insurance"
  | "coverage_result"
  | "contact"
  | "subscriber"
  | "confirm"
  | "submitting"
  | "done";

function stepsFor(paymentMethod: PaymentMethod | ""): StepId[] {
  if (paymentMethod === "insurance") {
    return ["service", "identity", "insurance", "coverage_result", "contact", "subscriber", "confirm"];
  }
  if (paymentMethod === "self_pay") {
    return ["service", "identity", "contact", "confirm"];
  }
  // payment not yet chosen — show only first step
  return ["service"];
}

// Visible step count in the progress bar (we hide the coverage_result tick
// because it's a system step, not a user-input step).
function progressSteps(paymentMethod: PaymentMethod | ""): StepId[] {
  return stepsFor(paymentMethod).filter((s) => s !== "coverage_result");
}

// =====================================================================
// Component
// =====================================================================

export default function BookingFlow() {
  const [step, setStep] = useState<StepId>("service");
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [coverage, setCoverage] = useState<CoverageResponse | null>(null);
  const [coverageError, setCoverageError] = useState<string | null>(null);
  const [coverageLoading, setCoverageLoading] = useState(false);
  const [intakeResult, setIntakeResult] = useState<IntakeResponse | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Re-evaluate the active step's position any time payment method changes
  const visibleSteps = useMemo(() => progressSteps(form.paymentMethod), [form.paymentMethod]);
  const stepIndex = visibleSteps.indexOf(
    step === "coverage_result" ? "insurance" : step === "submitting" || step === "done" ? "confirm" : step,
  );
  const totalSteps = visibleSteps.length;

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  // -------- Validation per step --------
  const serviceValue = form.service === "Other" ? form.serviceOther.trim() : form.service;
  const canAdvance: Record<StepId, boolean> = {
    service: !!serviceValue && !!form.paymentMethod && !!form.modality,
    identity: !!form.firstName.trim() && !!form.lastName.trim() && !!form.dob,
    insurance: !!form.payerName.trim() && !!form.memberId.trim(),
    coverage_result: !!coverage,
    contact:
      !!form.phone.trim() &&
      !!form.email.trim() &&
      !!form.homeAddress.trim() &&
      !!form.sex.trim(),
    subscriber: !!form.subscriberName.trim() && !!form.subscriberRelationship.trim(),
    confirm: true,
    submitting: false,
    done: false,
  };

  // -------- Step transitions --------
  function goNext() {
    const path = stepsFor(form.paymentMethod);
    const i = path.indexOf(step);
    if (i < 0 || i === path.length - 1) return;

    const next = path[i + 1];

    // Special: when leaving "insurance" we run the coverage check first.
    if (step === "insurance") {
      void runCoverageCheck();
      return;
    }

    setStep(next);
  }

  function goBack() {
    const path = stepsFor(form.paymentMethod);
    const i = path.indexOf(step);
    if (i <= 0) return;
    setStep(path[i - 1]);
  }

  // -------- Coverage check (intermediate step) --------
  async function runCoverageCheck() {
    setCoverageLoading(true);
    setCoverageError(null);
    setCoverage(null);
    try {
      const r = await fetch("/v1/coverage/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          first_name: form.firstName.trim(),
          last_name: form.lastName.trim(),
          date_of_birth: form.dob,
          payer_name: form.payerName.trim(),
          member_id: form.memberId.trim(),
          email: form.email.trim() || undefined,
          phone: form.phone.trim() || undefined,
        }),
      });
      if (!r.ok) throw new Error(await r.text());
      const data = (await r.json()) as CoverageResponse;
      setCoverage(data);
      // Prefill subscriber name with patient name when self-relationship is implied
      if (!form.subscriberName.trim()) {
        update("subscriberName", `${form.firstName.trim()} ${form.lastName.trim()}`.trim());
      }
      if (!form.subscriberRelationship.trim()) {
        update("subscriberRelationship", "Self");
      }
      setStep("coverage_result");
    } catch (err) {
      setCoverageError(err instanceof Error ? err.message : "Coverage check failed");
    } finally {
      setCoverageLoading(false);
    }
  }

  // -------- Final booking submit --------
  async function submitBooking() {
    setStep("submitting");
    setSubmitError(null);
    try {
      const body = {
        flow: "booking",
        service: serviceValue,
        payment_method: form.paymentMethod,
        first_name: form.firstName.trim(),
        last_name: form.lastName.trim(),
        date_of_birth: form.dob,
        phone: form.phone.trim(),
        email: form.email.trim(),
        home_address: form.homeAddress.trim(),
        sex: form.sex.trim(),
        ...(form.paymentMethod === "insurance"
          ? {
              insurance_name: form.payerName.trim(),
              insurance_member_id: form.memberId.trim(),
              subscriber_name: form.subscriberName.trim(),
              subscriber_relationship: form.subscriberRelationship.trim(),
            }
          : {}),
        notes: buildNotes(form),
        sms_opt_in: form.smsConsent,
        sms_marketing_opt_in: form.smsMarketingConsent,
      };
      const r = await fetch("/v1/intake", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(await r.text());
      const data = (await r.json()) as IntakeResponse;
      setIntakeResult(data);
      setStep("done");
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Submission failed");
      setStep("confirm");
    }
  }

  function reset() {
    setForm(EMPTY_FORM);
    setCoverage(null);
    setCoverageError(null);
    setIntakeResult(null);
    setSubmitError(null);
    setStep("service");
  }

  // -------- Render --------
  return (
    <div
      className="bg-cream-alt p-5 sm:p-10 lg:p-12 shadow-soft"
      style={{ borderRadius: "28px 0 28px 28px" }}
    >
      {/* Header */}
      <div className="flex items-start gap-3 mb-6">
        <span
          className="w-11 h-11 rounded-full grid place-items-center mt-0.5 shrink-0"
          style={{ backgroundColor: "rgba(225,184,120,0.22)" }}
        >
          <FiCalendar size={18} style={{ color: "#66202A" }} />
        </span>
        <div className="min-w-0">
          <span
            className="text-[11px] font-semibold uppercase tracking-[0.18em]"
            style={{ color: "#E1B878" }}
          >
            Book an appointment
          </span>
          <h3 className="font-display text-2xl sm:text-3xl text-ink font-bold mt-0.5">
            Tell us a little about you
          </h3>
          <p className="text-sm text-ink-muted mt-1.5 leading-relaxed">
            We'll check your coverage and a care-team member will reach out within one business day.
          </p>
        </div>
      </div>

      {/* Progress */}
      {step !== "done" && (
        <div className="mb-7">
          <div className="flex items-center gap-1.5">
            {Array.from({ length: totalSteps }).map((_, i) => (
              <span
                key={i}
                className="h-1.5 flex-1 rounded-full transition-all duration-300"
                style={{
                  backgroundColor: i <= stepIndex ? "#E1B878" : "#E5E5E5",
                }}
              />
            ))}
          </div>
          <div className="text-[11px] text-ink-soft mt-2 tabular-nums">
            Step {Math.max(1, stepIndex + 1)} of {totalSteps}
          </div>
        </div>
      )}

      {/* Body */}
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={step}
          initial={{ opacity: 0, x: 16 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -16 }}
          transition={{ duration: 0.22 }}
        >
          {step === "service" && (
            <ServiceStep form={form} update={update} />
          )}

          {step === "identity" && (
            <IdentityStep form={form} update={update} />
          )}

          {step === "insurance" && (
            <InsuranceStep
              form={form}
              update={update}
              loading={coverageLoading}
              error={coverageError}
            />
          )}

          {step === "coverage_result" && coverage && (
            <CoverageResultStep
              data={coverage}
              onEdit={() => setStep("insurance")}
            />
          )}

          {step === "contact" && (
            <ContactStep form={form} update={update} />
          )}

          {step === "subscriber" && (
            <SubscriberStep form={form} update={update} />
          )}

          {step === "confirm" && (
            <ConfirmStep
              form={form}
              update={update}
              serviceValue={serviceValue}
              coverage={coverage}
              error={submitError}
              onEditStep={(s) => setStep(s)}
            />
          )}

          {step === "submitting" && <SubmittingStep />}

          {step === "done" && intakeResult && (
            <DoneStep result={intakeResult} onReset={reset} />
          )}
        </motion.div>
      </AnimatePresence>

      {/* Footer controls */}
      {step !== "done" && step !== "submitting" && (
        <div className="mt-8 pt-6 border-t border-surface-line flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={goBack}
            disabled={stepsFor(form.paymentMethod).indexOf(step) <= 0 || coverageLoading}
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-soft hover:text-ink disabled:opacity-30 transition px-3 py-3 min-h-[44px]"
          >
            <FiArrowLeft size={14} /> Back
          </button>

          {step === "confirm" ? (
            <button
              type="button"
              onClick={() => void submitBooking()}
              className="btn-primary"
            >
              Submit booking <FiArrowRight />
            </button>
          ) : step === "coverage_result" ? (
            <button
              type="button"
              onClick={goNext}
              className="btn-primary"
            >
              Continue <FiArrowRight />
            </button>
          ) : step === "insurance" ? (
            <button
              type="button"
              onClick={goNext}
              disabled={!canAdvance[step] || coverageLoading}
              className="btn-primary disabled:opacity-50"
            >
              {coverageLoading ? "Checking coverage…" : (
                <>Check coverage <FiArrowRight /></>
              )}
            </button>
          ) : (
            <button
              type="button"
              onClick={goNext}
              disabled={!canAdvance[step]}
              className="btn-primary disabled:opacity-50"
            >
              Continue <FiArrowRight />
            </button>
          )}
        </div>
      )}

      {/* Secondary fallback: quick question */}
      {step === "service" && <QuickQuestionLink />}
    </div>
  );
}

// =====================================================================
// Steps
// =====================================================================

function ServiceStep({ form, update }: { form: FormState; update: <K extends keyof FormState>(k: K, v: FormState[K]) => void }) {
  return (
    <div>
      <Heading text="What's bringing you in?" sub="Pick the topic that fits best — you can change it later." />
      <div className="flex flex-wrap gap-2">
        {SERVICE_OPTIONS.map((opt) => (
          <Chip
            key={opt}
            label={opt}
            active={form.service === opt}
            onClick={() => update("service", opt)}
          />
        ))}
        <Chip
          label="Other"
          active={form.service === "Other"}
          onClick={() => update("service", "Other")}
        />
      </div>

      {form.service === "Other" && (
        <div className="mt-4">
          <Field
            label="Tell us briefly"
            value={form.serviceOther}
            onChange={(v) => update("serviceOther", v)}
            placeholder="e.g., adjusting after a recent move"
          />
        </div>
      )}

      <SubHeading text="How would you like to pay?" />
      <div className="grid sm:grid-cols-2 gap-3">
        <ChoiceCard
          icon={<FiCreditCard />}
          label="Use my insurance"
          sub="We'll verify your benefits in real time"
          active={form.paymentMethod === "insurance"}
          onClick={() => update("paymentMethod", "insurance")}
        />
        <ChoiceCard
          icon={<FiDollarSign />}
          label="Self-pay"
          sub="Competitive cash rates & sliding scale"
          active={form.paymentMethod === "self_pay"}
          onClick={() => update("paymentMethod", "self_pay")}
        />
      </div>

      <SubHeading text="How would you prefer to meet?" />
      <div className="grid gap-2.5">
        {MODALITY_OPTIONS.map((m) => (
          <ChoiceCard
            key={m.id}
            icon={m.icon}
            label={m.label}
            sub={m.sub}
            active={form.modality === m.id}
            onClick={() => update("modality", m.id)}
          />
        ))}
      </div>
    </div>
  );
}

function IdentityStep({ form, update }: { form: FormState; update: <K extends keyof FormState>(k: K, v: FormState[K]) => void }) {
  return (
    <div>
      <Heading text="Who are we booking for?" sub="Match the spelling on your insurance card or government ID." />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field
          label="First name"
          value={form.firstName}
          onChange={(v) => update("firstName", v)}
          required
          icon={<FiUser size={14} />}
          autoComplete="given-name"
        />
        <Field
          label="Last name"
          value={form.lastName}
          onChange={(v) => update("lastName", v)}
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
          onChange={(v) => update("dob", v)}
          required
          icon={<FiCalendar size={14} />}
          autoComplete="bday"
        />
      </div>
    </div>
  );
}

function InsuranceStep({
  form,
  update,
  loading,
  error,
}: {
  form: FormState;
  update: <K extends keyof FormState>(k: K, v: FormState[K]) => void;
  loading: boolean;
  error: string | null;
}) {
  const isListedPayer = PAYERS.some((p) => p.name === form.payerName);
  const [otherMode, setOtherMode] = useState(!!form.payerName && !isListedPayer);

  return (
    <div>
      <Heading
        text="Check your insurance"
        sub="We'll verify eligibility live through your payer — this usually takes a few seconds."
      />

      <span className="block text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-soft mb-1.5">
        Insurance plan <span style={{ color: "#66202A" }}>*</span>
      </span>
      <div className="flex flex-wrap gap-2 mb-4">
        {PAYERS.map((p) => (
          <Chip
            key={p.id}
            label={p.name}
            active={!otherMode && form.payerName === p.name}
            onClick={() => {
              setOtherMode(false);
              update("payerName", p.name);
            }}
          />
        ))}
        <Chip
          label="Other (not listed)"
          active={otherMode}
          onClick={() => {
            setOtherMode(true);
            if (isListedPayer) update("payerName", "");
          }}
        />
      </div>

      {otherMode && (
        <div className="mb-4">
          <Field
            label="Your insurance plan"
            value={form.payerName}
            onChange={(v) => update("payerName", v)}
            placeholder="Type the plan name as printed on your card"
          />
        </div>
      )}

      <Field
        label="Member / Subscriber ID"
        value={form.memberId}
        onChange={(v) => update("memberId", v)}
        required
        icon={<FiHash size={14} />}
        placeholder="As printed on your card"
      />

      <p className="text-[11px] text-ink-soft mt-4 leading-relaxed">
        Transmitted over HIPAA-secure channels. Used only to verify benefits.
      </p>

      {error && (
        <div
          className="mt-4 p-3.5 text-sm"
          style={{
            backgroundColor: "rgba(225,184,120,0.18)",
            border: "1px solid #E1B878",
            borderRadius: "12px 0 12px 12px",
            color: "#66202A",
          }}
        >
          We had trouble reaching verification. You can try again, or continue — our care team will verify manually.
        </div>
      )}

      {loading && (
        <div className="mt-4 flex items-center gap-2 text-sm text-ink-soft">
          <span className="w-3 h-3 rounded-full bg-brand animate-pulse" />
          Verifying with {form.payerName || "your payer"}…
        </div>
      )}
    </div>
  );
}

function CoverageResultStep({
  data,
  onEdit,
}: {
  data: CoverageResponse;
  onEdit: () => void;
}) {
  // Eligibility is the boolean — coverage_status can be CLAIM.MD strings like
  // "active" or "unknown" that don't equal the literal "eligible".
  const isEligible = data.eligible;
  const isVerificationError = data.coverage_status === "verification_error";

  const accent = isEligible
    ? { bg: "rgba(34,160,98,0.10)", border: "rgba(34,160,98,0.5)", chip: "#1f8a55", icon: <FiCheck size={18} className="text-white" /> }
    : { bg: "rgba(225,184,120,0.18)", border: "#E1B878", chip: "#66202A", icon: <FiAlertTriangle size={18} className="text-white" /> };

  const badgeLabel = isEligible
    ? "In-network — coverage confirmed"
    : isVerificationError
      ? "We'll verify manually as you book"
      : "We'll verify manually as you book";

  // Booking-flow message — overrides the gateway's standalone "care team will
  // reach out within 1 business day" copy because the visitor is right now
  // in the middle of a booking and will continue immediately.
  const message = isEligible
    ? `You're covered through ${data.payer}${data.copay ? ` — estimated copay $${data.copay}` : ""}. Continue below to finish your booking.`
    : isVerificationError
      ? `We couldn't reach ${data.payer} just now. You can keep going — we'll verify your benefits manually before your first session.`
      : `We couldn't auto-confirm coverage with ${data.payer}. You can keep going — we'll verify manually and walk through options before your first session.`;

  return (
    <div>
      <Heading text="Your coverage result" sub="You can still finish booking either way — our care team will follow up." />

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
            className="w-10 h-10 rounded-full grid place-items-center shrink-0"
            style={{ backgroundColor: accent.chip }}
          >
            {accent.icon}
          </span>
          <div className="min-w-0">
            <div
              className="text-[11px] font-semibold uppercase tracking-[0.16em]"
              style={{ color: accent.chip }}
            >
              {badgeLabel}
            </div>
            <div className="font-display text-lg font-bold text-ink leading-tight truncate">
              {data.payer}
            </div>
          </div>
        </div>

        {(data.plan || data.copay) && (
          <div className="mt-4 grid grid-cols-2 gap-3">
            {data.copay && (
              <div>
                <div className="text-[10px] uppercase tracking-[0.18em] text-ink-soft font-semibold">
                  Estimated copay
                </div>
                <div className="font-display text-2xl text-ink font-bold tabular-nums mt-1">
                  ${data.copay}
                </div>
              </div>
            )}
            {data.plan && (
              <div>
                <div className="text-[10px] uppercase tracking-[0.18em] text-ink-soft font-semibold">
                  Plan
                </div>
                <div className="font-display text-base text-ink font-bold mt-1 leading-tight">
                  {data.plan}
                </div>
              </div>
            )}
          </div>
        )}

        <p className="mt-4 text-sm text-ink leading-relaxed">
          {message}
        </p>
      </div>

      <button
        type="button"
        onClick={onEdit}
        className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-ink-soft hover:text-ink transition"
      >
        <FiEdit2 size={13} /> Edit insurance details
      </button>
    </div>
  );
}

function ContactStep({ form, update }: { form: FormState; update: <K extends keyof FormState>(k: K, v: FormState[K]) => void }) {
  const isListedSex = SEX_OPTIONS.slice(0, 3).includes(form.sex);
  const [sexOther, setSexOther] = useState(!!form.sex && !isListedSex);

  return (
    <div>
      <Heading text="A few last details" sub="We need these to confirm your appointment and reach you back." />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field
          label="Phone"
          type="tel"
          value={form.phone}
          onChange={(v) => update("phone", v)}
          required
          icon={<FiPhone size={14} />}
          autoComplete="tel"
        />
        <Field
          label="Email"
          type="email"
          value={form.email}
          onChange={(v) => update("email", v)}
          required
          icon={<FiMail size={14} />}
          autoComplete="email"
        />
      </div>
      <div className="mt-3">
        <Field
          label="Home address"
          value={form.homeAddress}
          onChange={(v) => update("homeAddress", v)}
          required
          icon={<FiMapPin size={14} />}
          placeholder="Street, city, state, zip"
          autoComplete="street-address"
        />
      </div>

      <SubHeading text="Sex (for the medical record)" sub="How you identify — held in confidence with our care team." />
      <div className="flex flex-wrap gap-2">
        {SEX_OPTIONS.slice(0, 3).map((opt) => (
          <Chip
            key={opt}
            label={opt}
            active={!sexOther && form.sex === opt}
            onClick={() => {
              setSexOther(false);
              update("sex", opt);
            }}
          />
        ))}
        <Chip
          label="Other"
          active={sexOther}
          onClick={() => {
            setSexOther(true);
            if (isListedSex) update("sex", "");
          }}
        />
      </div>
      {sexOther && (
        <div className="mt-3">
          <Field
            label="How you identify"
            value={form.sex}
            onChange={(v) => update("sex", v)}
            placeholder="e.g., transgender male"
          />
        </div>
      )}

      <div className="mt-5">
        <Field
          label="Anything we should know? (optional)"
          value={form.notes}
          onChange={(v) => update("notes", v)}
          placeholder="Scheduling preferences, accessibility needs…"
          multiline
        />
      </div>
    </div>
  );
}

function SubscriberStep({ form, update }: { form: FormState; update: <K extends keyof FormState>(k: K, v: FormState[K]) => void }) {
  return (
    <div>
      <Heading
        text="Who is the policy subscriber?"
        sub="Required by your insurer. If the plan is in your name, choose 'Self'."
      />

      <span className="block text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-soft mb-1.5">
        Relationship to subscriber <span style={{ color: "#66202A" }}>*</span>
      </span>
      <div className="flex flex-wrap gap-2 mb-4">
        {RELATIONSHIP_OPTIONS.map((opt) => (
          <Chip
            key={opt}
            label={opt}
            active={form.subscriberRelationship === opt}
            onClick={() => {
              update("subscriberRelationship", opt);
              if (opt === "Self") {
                update("subscriberName", `${form.firstName.trim()} ${form.lastName.trim()}`.trim());
              }
            }}
          />
        ))}
      </div>

      <Field
        label="Subscriber's full name"
        value={form.subscriberName}
        onChange={(v) => update("subscriberName", v)}
        required
        icon={<FiUsers size={14} />}
        placeholder="Name as printed on the card"
      />
    </div>
  );
}

function ConfirmStep({
  form,
  update,
  serviceValue,
  coverage,
  error,
  onEditStep,
}: {
  form: FormState;
  update: <K extends keyof FormState>(k: K, v: FormState[K]) => void;
  serviceValue: string;
  coverage: CoverageResponse | null;
  error: string | null;
  onEditStep: (s: StepId) => void;
}) {
  const rows: { label: string; value: string; step: StepId }[] = [
    { label: "Reason", value: serviceValue, step: "service" },
    { label: "Payment", value: form.paymentMethod === "insurance" ? "Insurance" : "Self-pay", step: "service" },
    { label: "Preferred format", value: modalityLabel(form.modality), step: "service" },
    { label: "Name", value: `${form.firstName} ${form.lastName}`.trim(), step: "identity" },
    { label: "Date of birth", value: formatDOB(form.dob), step: "identity" },
    { label: "Phone", value: form.phone, step: "contact" },
    { label: "Email", value: form.email, step: "contact" },
    { label: "Home address", value: form.homeAddress, step: "contact" },
    { label: "Sex", value: form.sex, step: "contact" },
  ];

  if (form.paymentMethod === "insurance") {
    rows.push(
      { label: "Insurance", value: form.payerName, step: "insurance" },
      { label: "Member ID", value: form.memberId, step: "insurance" },
      { label: "Subscriber", value: `${form.subscriberName} (${form.subscriberRelationship})`, step: "subscriber" },
    );
  }

  return (
    <div>
      <Heading text="Confirm your details" sub="Take a quick look. Tap any field to edit." />

      {coverage && (
        <div
          className="mb-4 p-3.5 flex items-center gap-3"
          style={{
            backgroundColor: coverage.eligible ? "rgba(34,160,98,0.10)" : "rgba(225,184,120,0.16)",
            border: `1px solid ${coverage.eligible ? "rgba(34,160,98,0.5)" : "#E1B878"}`,
            borderRadius: "14px 0 14px 14px",
          }}
        >
          <FiShield size={18} style={{ color: coverage.eligible ? "#1f8a55" : "#66202A" }} />
          <div className="min-w-0 text-sm text-ink">
            <span className="font-semibold">{coverage.payer}</span>
            {" — "}
            {coverage.eligible
              ? `coverage confirmed${coverage.copay ? ` (copay ~$${coverage.copay})` : ""}`
              : "we'll verify manually before your first session"}
          </div>
        </div>
      )}

      <ul className="divide-y border border-surface-line bg-white" style={{ borderRadius: "14px 0 14px 14px" }}>
        {rows.map((r) => (
          <li key={r.label} className="flex items-start justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-[0.16em] text-ink-soft font-semibold">{r.label}</div>
              <div className="text-sm text-ink mt-0.5 [overflow-wrap:anywhere]">{r.value || "—"}</div>
            </div>
            <button
              type="button"
              onClick={() => onEditStep(r.step)}
              className="text-[12px] font-semibold text-brand-700 hover:underline shrink-0 mt-1"
            >
              Edit
            </button>
          </li>
        ))}
      </ul>

      {form.notes && (
        <div className="mt-4 p-3.5 bg-white border border-surface-line text-sm text-ink" style={{ borderRadius: "12px 0 12px 12px" }}>
          <div className="text-[10px] uppercase tracking-[0.16em] text-ink-soft font-semibold mb-1">Notes</div>
          {form.notes}
        </div>
      )}

      {error && (
        <p className="mt-4 text-sm text-red-700">
          We couldn't submit your booking — please try again or call <a href="tel:7252386990" className="underline font-semibold">725-238-6990</a>.
        </p>
      )}

      <p className="text-[11px] text-ink-soft mt-5 leading-relaxed">
        By submitting, you consent to be contacted at the phone or email above. Your information is stored over HIPAA-secure channels.
      </p>

      <label htmlFor="bf-sms-consent" className="mt-4 flex items-start gap-3 cursor-pointer">
        <input
          id="bf-sms-consent"
          type="checkbox"
          checked={form.smsConsent}
          onChange={(e) => update("smsConsent", e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 accent-[#E1B878]"
        />
        <span className="text-[12px] text-ink-soft leading-relaxed">
          I agree to receive appointment reminders, confirmations, and schedule changes from
          Brighter Tomorrow Therapy at the number provided. Message frequency varies. Msg &amp;
          data rates may apply. Reply STOP to cancel, HELP for help.
        </span>
      </label>

      <label htmlFor="bf-sms-marketing-consent" className="mt-4 flex items-start gap-3 cursor-pointer">
        <input
          id="bf-sms-marketing-consent"
          type="checkbox"
          checked={form.smsMarketingConsent}
          onChange={(e) => update("smsMarketingConsent", e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 accent-[#E1B878]"
        />
        <span className="text-[12px] text-ink-soft leading-relaxed">
          I separately agree to receive marketing and practice-update text messages from
          Brighter Tomorrow Therapy at the number provided. This is optional and not a condition
          of service. Message frequency varies. Msg &amp; data rates may apply. Reply STOP to
          cancel, HELP for help.
        </span>
      </label>
    </div>
  );
}

function SubmittingStep() {
  return (
    <div className="py-10 text-center">
      <div
        className="mx-auto w-14 h-14 rounded-full grid place-items-center mb-4"
        style={{ backgroundColor: "rgba(225,184,120,0.22)" }}
      >
        <motion.span
          className="w-5 h-5 rounded-full border-2"
          style={{ borderColor: "#66202A", borderTopColor: "transparent" }}
          animate={{ rotate: 360 }}
          transition={{ duration: 0.8, repeat: Infinity, ease: "linear" }}
        />
      </div>
      <h4 className="font-display text-xl text-ink font-bold">Submitting your booking…</h4>
      <p className="text-sm text-ink-soft mt-2">Hang tight for just a moment.</p>
    </div>
  );
}

function DoneStep({ onReset }: { result: IntakeResponse; onReset: () => void }) {
  return (
    <div className="text-center py-4">
      <div
        className="mx-auto w-14 h-14 rounded-full grid place-items-center mb-4"
        style={{ backgroundColor: "rgba(225,184,120,0.22)" }}
      >
        <FiCheck size={26} style={{ color: "#66202A" }} />
      </div>
      <h4 className="font-display text-2xl text-ink font-bold">We got your request.</h4>
      <p className="text-sm text-ink-muted mt-3 max-w-md mx-auto leading-relaxed">
        You'll get a confirmation via email shortly.
      </p>
      <div className="mt-6 flex items-center justify-center gap-3">
        <a href="tel:7252386990" className="inline-flex items-center gap-2 text-sm font-semibold text-brand-700 hover:underline">
          <FiPhone size={14} /> 725-238-6990
        </a>
        <button type="button" onClick={onReset} className="text-sm font-semibold text-ink-soft hover:text-ink">
          Submit another request
        </button>
      </div>
    </div>
  );
}

// =====================================================================
// Primitives
// =====================================================================

function Heading({ text, sub }: { text: string; sub?: string }) {
  return (
    <div className="mb-5">
      <h4 className="font-display text-[1.25rem] sm:text-[1.4rem] text-ink font-bold leading-tight">{text}</h4>
      {sub && <p className="text-sm text-ink-soft mt-1.5 leading-relaxed">{sub}</p>}
    </div>
  );
}

function SubHeading({ text, sub }: { text: string; sub?: string }) {
  return (
    <div className="mt-7 mb-3">
      <h5 className="font-display text-base text-ink font-semibold">{text}</h5>
      {sub && <p className="text-xs text-ink-soft mt-1">{sub}</p>}
    </div>
  );
}

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-sm font-medium border transition"
      style={{
        backgroundColor: active ? "#66202A" : "#F4F4F4",
        color: active ? "#fff" : "#192735",
        borderColor: active ? "#66202A" : "#D9D9D9",
      }}
    >
      {active && <FiCheck size={13} />}
      {label}
    </button>
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
      className="text-left p-4 transition flex items-start gap-3 w-full"
      style={{
        backgroundColor: active ? "rgba(225,184,120,0.18)" : "#fff",
        borderRadius: "14px 0 14px 14px",
        border: `1.5px solid ${active ? "#E1B878" : "#E5E5E5"}`,
      }}
    >
      <span
        className="w-9 h-9 grid place-items-center rounded-full shrink-0"
        style={{ backgroundColor: active ? "#66202A" : "#F4F4F4", color: active ? "#fff" : "#66202A" }}
      >
        {icon}
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-[15px] font-semibold text-ink">{label}</span>
        {sub && <span className="block text-xs text-ink-soft mt-0.5">{sub}</span>}
      </span>
      {active && <FiCheck size={16} style={{ color: "#66202A" }} className="mt-1" />}
    </button>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  required,
  icon,
  placeholder,
  autoComplete,
  multiline,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  icon?: React.ReactNode;
  placeholder?: string;
  autoComplete?: string;
  multiline?: boolean;
}) {
  return (
    <label className="block">
      <span className="block text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-soft mb-1.5">
        {label}{required && <span style={{ color: "#66202A" }}> *</span>}
      </span>
      <span className="relative block">
        {icon && !multiline && (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-soft pointer-events-none">
            {icon}
          </span>
        )}
        {multiline ? (
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            required={required}
            placeholder={placeholder}
            rows={3}
            className="w-full bg-white border border-surface-line rounded-lg px-3 py-2.5 text-sm text-ink focus:outline-none focus:border-brand transition resize-none placeholder-ink-soft"
          />
        ) : (
          <input
            type={type}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            required={required}
            placeholder={placeholder}
            autoComplete={autoComplete}
            className={`w-full bg-white border border-surface-line rounded-lg py-2.5 text-sm text-ink focus:outline-none focus:border-brand transition placeholder-ink-soft ${
              icon ? "pl-9 pr-3" : "px-3"
            }`}
          />
        )}
      </span>
    </label>
  );
}

function QuickQuestionLink() {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-6 pt-5 border-t border-surface-line text-center">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="text-sm font-medium text-ink-soft hover:text-ink transition underline underline-offset-4"
      >
        {open ? "Hide quick message" : "Just have a question? Send a quick message instead"}
      </button>
      {open && <QuickMessageForm />}
    </div>
  );
}

function QuickMessageForm() {
  const [state, setState] = useState<{ status: "idle" | "sending" | "ok" | "err" }>({ status: "idle" });

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setState({ status: "sending" });
    const fd = new FormData(e.currentTarget);
    const payload = {
      full_name: String(fd.get("full_name") || ""),
      email: String(fd.get("email") || ""),
      phone: String(fd.get("phone") || ""),
      subject: "Quick question (web)",
      message: String(fd.get("message") || ""),
    };
    try {
      const r = await fetch("/v1/contact", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!r.ok) throw new Error(await r.text());
      setState({ status: "ok" });
      e.currentTarget.reset();
    } catch {
      setState({ status: "err" });
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-5 grid gap-3 text-left">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <SimpleInput name="full_name" placeholder="Your name" required />
        <SimpleInput name="email" type="email" placeholder="Email" required />
      </div>
      <SimpleInput name="phone" type="tel" placeholder="Phone (optional)" />
      <textarea
        name="message"
        required
        rows={3}
        placeholder="Your message…"
        className="w-full bg-white border border-surface-line rounded-lg px-3 py-2.5 text-sm text-ink focus:outline-none focus:border-brand transition resize-none placeholder-ink-soft"
      />
      <div className="flex items-center justify-end gap-3">
        {state.status === "ok" && <span className="text-sage-700 text-sm">Thanks — we'll be in touch.</span>}
        {state.status === "err" && <span className="text-red-700 text-sm">Couldn't send. Please try again.</span>}
        <button
          type="submit"
          disabled={state.status === "sending"}
          className="btn-primary disabled:opacity-60"
        >
          {state.status === "sending" ? "Sending…" : "Send"}
        </button>
      </div>
    </form>
  );
}

function SimpleInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className="w-full bg-white border border-surface-line rounded-lg px-3 py-2.5 text-sm text-ink focus:outline-none focus:border-brand transition placeholder-ink-soft"
    />
  );
}

// =====================================================================
// Helpers
// =====================================================================

function buildNotes(form: FormState): string {
  const parts: string[] = [];
  if (form.modality) parts.push(`Preferred format: ${modalityLabel(form.modality)}`);
  if (form.notes.trim()) parts.push(form.notes.trim());
  return parts.join(" — ").slice(0, 2000);
}

function modalityLabel(m: FormState["modality"]) {
  if (m === "in-person") return "In-person";
  if (m === "telehealth") return "Telehealth";
  if (m === "either") return "Either";
  return "";
}

function formatDOB(iso: string): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const idx = Number(m) - 1;
  if (idx < 0 || idx > 11) return iso;
  return `${months[idx]} ${Number(d)}, ${y}`;
}
