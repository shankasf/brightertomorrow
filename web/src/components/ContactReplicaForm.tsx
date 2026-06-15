"use client";

import { useState } from "react";

const WINE = "#66202A";

const HELP_OPTIONS = [
  "I'm interested in starting therapy",
  "Individual Therapy",
  "Couples / Relationship Counseling",
  "Family or Child Therapy",
  "Referral / Professional Inquiry",
  "Wellness Services (e.g., breathwork, Reiki)",
  "Supervision / Training Inquiry",
  "Other (please describe below)",
] as const;

const CONTACT_METHODS = ["Email", "Phone Call", "Text"] as const;

type SubmitState = "idle" | "sending" | "ok" | "err";

const labelCls =
  "block text-[13px] font-medium text-ink mb-1.5";
const inputCls =
  "w-full bg-white border border-surface-line rounded-md px-3.5 py-2.5 text-[15px] text-ink focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand transition placeholder-ink-soft";
const selectCls = `${inputCls} appearance-none bg-no-repeat pr-9`;

// Inline chevron for selects (avoids an extra icon import)
const selectStyle: React.CSSProperties = {
  backgroundImage:
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23858585' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E\")",
  backgroundPosition: "right 0.85rem center",
};

export default function ContactReplicaForm() {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [help, setHelp] = useState("");
  const [otherDescribe, setOtherDescribe] = useState("");
  const [contactMethod, setContactMethod] = useState("");
  const [bestTime, setBestTime] = useState("");
  const [therapist, setTherapist] = useState("");
  const [consent, setConsent] = useState(false);
  const [smsConsent, setSmsConsent] = useState(false);
  const [state, setState] = useState<SubmitState>("idle");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!consent || state === "sending") return;
    setState("sending");

    const subject = help || "Contact form";

    // `message` stays NOT NULL server-side. Prefer the visitor's free-text
    // note; fall back to the selected topic so it is never empty.
    const message = otherDescribe.trim() || help || "Contact form";

    const payload = {
      full_name: `${firstName.trim()} ${lastName.trim()}`.trim(),
      email: email.trim(),
      phone: phone.trim(),
      subject,
      message,
      // Discrete fields — sent individually so the admin portal shows each
      // value the visitor entered (blank → stored NULL).
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      help_topic: help,
      other_describe: otherDescribe.trim(),
      preferred_contact_method: contactMethod,
      best_time: bestTime.trim(),
      therapist_requested: therapist.trim(),
      sms_opt_in: smsConsent,
    };

    try {
      const r = await fetch("/v1/contact", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!r.ok) throw new Error(await r.text());
      setState("ok");
      setFirstName("");
      setLastName("");
      setPhone("");
      setEmail("");
      setHelp("");
      setOtherDescribe("");
      setContactMethod("");
      setBestTime("");
      setTherapist("");
      setConsent(false);
      setSmsConsent(false);
    } catch {
      setState("err");
    }
  }

  if (state === "ok") {
    return (
      <div
        className="bg-white border border-surface-line rounded-lg p-8 sm:p-10 text-center shadow-soft"
        role="status"
        aria-live="polite"
      >
        <div
          className="mx-auto w-14 h-14 rounded-full grid place-items-center mb-5"
          style={{ backgroundColor: "rgba(225,184,120,0.22)" }}
        >
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={WINE} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <h3 className="display text-2xl text-ink">Thanks — we&apos;ll be in touch.</h3>
        <p className="mt-3 text-ink-muted leading-relaxed">
          Your message has been sent. A member of our team will reach out shortly.
        </p>
        <button
          type="button"
          onClick={() => setState("idle")}
          className="mt-6 text-sm font-semibold text-brand-700 hover:underline"
        >
          Send another message
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      className="bg-white border border-surface-line rounded-lg p-6 sm:p-8 shadow-soft"
      noValidate
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <div>
          <label htmlFor="cf-first" className={labelCls}>First Name</label>
          <input
            id="cf-first"
            type="text"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            autoComplete="given-name"
            placeholder="First Name"
            required
            className={inputCls}
          />
        </div>
        <div>
          <label htmlFor="cf-last" className={labelCls}>Last Name</label>
          <input
            id="cf-last"
            type="text"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            autoComplete="family-name"
            placeholder="Last Name"
            required
            className={inputCls}
          />
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-5">
        <div>
          <label htmlFor="cf-phone" className={labelCls}>Phone/Mobile</label>
          <input
            id="cf-phone"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            autoComplete="tel"
            placeholder="Phone Number"
            className={inputCls}
          />
        </div>
        <div>
          <label htmlFor="cf-email" className={labelCls}>Email</label>
          <input
            id="cf-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            placeholder="Email Address"
            required
            className={inputCls}
          />
        </div>
      </div>

      <div className="mt-5">
        <label htmlFor="cf-help" className={labelCls}>How can we help you today?</label>
        <select
          id="cf-help"
          value={help}
          onChange={(e) => setHelp(e.target.value)}
          className={selectCls}
          style={selectStyle}
        >
          <option value="">Please select an option from the list</option>
          {HELP_OPTIONS.map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      </div>

      <div className="mt-5">
        <label htmlFor="cf-other" className={labelCls}>Other, please describe below</label>
        <textarea
          id="cf-other"
          rows={4}
          value={otherDescribe}
          onChange={(e) => setOtherDescribe(e.target.value)}
          placeholder="Your Message"
          className={`${inputCls} resize-y`}
        />
      </div>

      <div className="mt-5">
        <label htmlFor="cf-method" className={labelCls}>Preferred contact method</label>
        <select
          id="cf-method"
          value={contactMethod}
          onChange={(e) => setContactMethod(e.target.value)}
          className={selectCls}
          style={selectStyle}
        >
          <option value="">- Select -</option>
          {CONTACT_METHODS.map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      </div>

      <div className="mt-5">
        <label htmlFor="cf-time" className={labelCls}>Best time to reach you</label>
        <input
          id="cf-time"
          type="text"
          value={bestTime}
          onChange={(e) => setBestTime(e.target.value)}
          className={inputCls}
        />
      </div>

      <div className="mt-5">
        <label htmlFor="cf-therapist" className={labelCls}>Therapist You Wish To Contact</label>
        <input
          id="cf-therapist"
          type="text"
          value={therapist}
          onChange={(e) => setTherapist(e.target.value)}
          className={inputCls}
        />
      </div>

      <p className="mt-6 text-[13px] leading-relaxed text-ink-soft">
        By submitting this form via this web portal, you acknowledge and accept the risks of
        communicating your health information via this unencrypted email and electronic messaging
        and wish to continue despite those risks. By clicking &ldquo;Yes, I want to submit this
        form&rdquo; you agree to hold Brighter Tomorrow Counseling Services harmless for unauthorized
        use, disclosure, or access of your protected health information sent via this electronic means.
      </p>

      <label className="mt-5 flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          required
          className="mt-0.5 h-4 w-4 shrink-0 accent-[#E1B878]"
        />
        <span className="text-[14px] text-ink leading-snug">
          Yes, I want to submit this form &amp; agree to the terms of use.
        </span>
      </label>

      <label htmlFor="cf-sms-consent" className="mt-4 flex items-start gap-3 cursor-pointer">
        <input
          id="cf-sms-consent"
          type="checkbox"
          checked={smsConsent}
          onChange={(e) => setSmsConsent(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 accent-[#E1B878]"
        />
        <span className="text-[14px] text-ink leading-snug">
          By checking this box, I agree to receive appointment reminders and marketing text
          messages from Brighter Tomorrow Therapy at the number provided. Consent is not a
          condition of service. Message frequency varies. Msg &amp; data rates may apply.
          Reply STOP to cancel, HELP for help.
        </span>
      </label>

      {state === "err" && (
        <p className="mt-5 text-sm text-red-700" role="alert">
          Something went wrong sending your message. Please try again, or call us at{" "}
          <a href="tel:+17252386990" className="font-semibold underline">725-238-6990</a>.
        </p>
      )}

      <button
        type="submit"
        disabled={!consent || state === "sending"}
        className="btn-primary mt-6 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {state === "sending" ? "Sending…" : "Contact Us"}
      </button>
    </form>
  );
}
