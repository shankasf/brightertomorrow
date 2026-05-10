"use client";

import { useState } from "react";
import { FiArrowRight, FiCheck, FiAlertCircle } from "react-icons/fi";
import { InlineSpinner } from "@/components/Spinner";

type Variant = "light" | "dark";

export default function NewsletterForm({ variant = "light" }: { variant?: Variant } = {}) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "loading" | "ok" | "err">("idle");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email) return;
    setState("loading");
    try {
      const r = await fetch("/v1/newsletter", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!r.ok) throw new Error();
      setState("ok");
      setEmail("");
    } catch {
      setState("err");
    }
  }

  const isDark = variant === "dark";

  // Light variant — sits on warm cream CTA band: pill input + brand button.
  if (!isDark) {
    return (
      <form
        onSubmit={onSubmit}
        className="group relative flex items-center gap-1.5 rounded-full bg-cream/90 ring-1 ring-ink/10 pl-5 pr-1.5 py-1.5 focus-within:ring-ink/30 focus-within:bg-white transition shadow-[0_1px_0_rgba(255,255,255,0.6)_inset]"
        aria-live="polite"
      >
        <input
          type="email"
          required
          placeholder="you@email.com"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (state !== "loading") setState("idle");
          }}
          className="flex-1 min-w-0 bg-transparent text-[14px] text-ink placeholder:text-ink/40 focus:outline-none py-2 font-medium"
          aria-label="Email address"
        />
        <button
          type="submit"
          disabled={state === "loading"}
          className="relative shrink-0 inline-flex items-center justify-center h-10 px-4 rounded-[16px_0_16px_16px] bg-brand text-ink text-[13px] font-semibold uppercase tracking-[0.12em] hover:bg-ink hover:text-cream transition shadow-[0_8px_22px_-10px_rgba(25,39,53,0.4)]"
          aria-label={state === "ok" ? "Subscribed" : "Subscribe"}
        >
          {state === "ok" ? (
            <span className="inline-flex items-center gap-1.5"><FiCheck size={15} /> Subscribed</span>
          ) : state === "err" ? (
            <span className="inline-flex items-center gap-1.5"><FiAlertCircle size={15} /> Try again</span>
          ) : (
            <span className="inline-flex items-center gap-1.5">
              {state === "loading" ? "Sending" : "Subscribe"}
              {state === "loading" ? (
                <InlineSpinner size={14} />
              ) : (
                <FiArrowRight size={14} className="transition-transform group-focus-within:translate-x-0.5" />
              )}
            </span>
          )}
        </button>
      </form>
    );
  }

  // Dark variant — minimalist underline-only on deep ink footer.
  return (
    <form
      onSubmit={onSubmit}
      className="group relative flex items-center gap-3 border-b border-white/25 focus-within:border-white/60 transition pb-1.5"
      aria-live="polite"
    >
      <input
        type="email"
        required
        placeholder="you@email.com"
        value={email}
        onChange={(e) => {
          setEmail(e.target.value);
          if (state !== "loading") setState("idle");
        }}
        className="flex-1 min-w-0 bg-transparent text-[14px] text-white placeholder:text-white/35 focus:outline-none py-2"
        aria-label="Email address"
      />
      <button
        type="submit"
        disabled={state === "loading"}
        className="relative shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-full bg-brand text-white hover:bg-brand-400 disabled:opacity-60 transition"
        aria-label={state === "ok" ? "Subscribed" : "Subscribe"}
      >
        {state === "ok" ? (
          <FiCheck size={15} />
        ) : state === "err" ? (
          <FiAlertCircle size={15} />
        ) : state === "loading" ? (
          <InlineSpinner size={14} />
        ) : (
          <FiArrowRight size={14} />
        )}
      </button>
    </form>
  );
}
