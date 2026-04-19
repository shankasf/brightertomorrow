"use client";

import { useState } from "react";
import { FiSend, FiCheck, FiAlertCircle } from "react-icons/fi";

export default function NewsletterForm() {
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

  return (
    <form
      onSubmit={onSubmit}
      className="mt-3 group relative flex items-center gap-2 rounded-full bg-white/[0.06] ring-1 ring-white/10 backdrop-blur-sm pl-4 pr-1.5 py-1.5 focus-within:ring-brand/60 focus-within:bg-white/[0.08] transition shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]"
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
        className="flex-1 min-w-0 bg-transparent text-sm text-white placeholder:text-white/40 focus:outline-none py-2"
        aria-label="Email address"
      />
      <button
        type="submit"
        disabled={state === "loading"}
        className="relative shrink-0 inline-flex items-center justify-center w-10 h-10 rounded-full bg-brand text-white hover:bg-brand-400 disabled:opacity-60 transition shadow-[0_4px_18px_-6px_rgba(102,32,42,0.35)] hover:-translate-y-0.5"
        aria-label={state === "ok" ? "Subscribed" : "Subscribe"}
      >
        {state === "ok" ? (
          <FiCheck size={16} />
        ) : state === "err" ? (
          <FiAlertCircle size={16} />
        ) : (
          <FiSend size={15} className={state === "loading" ? "animate-pulse" : ""} />
        )}
      </button>
    </form>
  );
}
