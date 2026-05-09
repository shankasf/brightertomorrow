"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { FiCheck, FiMapPin, FiPhone, FiMail, FiClock, FiArrowUpRight } from "react-icons/fi";

const HOURS = [
  ["Monday", "8am – 8pm"],
  ["Tuesday", "8am – 8pm"],
  ["Wednesday", "8am – 8pm"],
  ["Thursday", "8am – 8pm"],
  ["Friday", "8am – 6pm"],
  ["Saturday", "9am – 2pm"],
];

export default function ContactPage() {
  const [state, setState] = useState<{ status: "idle" | "sending" | "ok" | "err"; msg?: string }>({ status: "idle" });

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setState({ status: "sending" });
    const fd = new FormData(e.currentTarget);
    const payload = Object.fromEntries(fd.entries());
    try {
      const r = await fetch("/v1/contact", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!r.ok) throw new Error(await r.text());
      setState({ status: "ok" });
      e.currentTarget.reset();
    } catch (err) {
      setState({ status: "err", msg: err instanceof Error ? err.message : "Failed" });
    }
  }

  return (
    <>
      {/* Page header */}
      <section className="bg-cream-alt relative overflow-hidden">
        <div aria-hidden className="absolute inset-0 bg-grid opacity-[0.06]" />
        <div className="container-narrow relative py-20 sm:py-24 lg:py-28 text-center">
          <span className="eyebrow center">Contact</span>
          <h1 className="mt-6 display text-5xl sm:text-6xl lg:text-7xl text-ink">
            Let&apos;s get you <span className="italic-accent">matched.</span>
          </h1>
          <svg aria-hidden viewBox="0 0 200 8" className="mx-auto mt-7 w-36 h-2 text-brand">
            <path d="M2 5 Q 50 0 100 4 T 198 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <p className="mt-7 text-ink-muted text-lg sm:text-xl leading-relaxed max-w-2xl mx-auto">
            Tell us a little about what you&apos;re looking for — we&apos;ll be in touch within one business day.
          </p>
        </div>
      </section>

      {/* Editorial split */}
      <section className="section bg-white">
        <div className="container-x grid lg:grid-cols-12 gap-10 lg:gap-16">
          {/* LEFT — info */}
          <div className="lg:col-span-5 order-2 lg:order-1">
            <span className="eyebrow">Reach us</span>
            <h2 className="mt-5 display text-4xl sm:text-5xl text-ink leading-[1.05]">
              We&apos;re here when
              <br />
              you&apos;re <span className="italic-accent">ready.</span>
            </h2>
            <p className="mt-5 text-ink-muted leading-relaxed">
              Call, email, or stop by either of our Las Vegas offices. Telehealth available across Nevada.
            </p>

            <div className="mt-10 space-y-1">
              {[
                { icon: <FiPhone />, label: "Call", value: "725-238-6990", href: "tel:725-238-6990" },
                { icon: <FiMail />, label: "Email", value: "admin@brightertomorrowtherapy.com", href: "mailto:admin@brightertomorrowtherapy.com" },
                { icon: <FiMapPin />, label: "E Russell", value: "3430 E Russell Rd Ste 315, Las Vegas, NV 89120" },
                { icon: <FiMapPin />, label: "N Durango", value: "6955 N Durango Dr Unit 1004, Las Vegas, NV 89149" },
              ].map((c, i) => (
                <a
                  key={i}
                  href={c.href ?? "#"}
                  className="group flex items-start gap-5 py-5 border-t border-surface-line hover:border-brand-700/40 transition last:border-b"
                >
                  <span className="mt-0.5 w-10 h-10 rounded-full bg-sage-100 text-sage-700 grid place-items-center shrink-0 group-hover:bg-sage-200 transition">
                    {c.icon}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="eyebrow-bare text-brand-700 text-[11px]">{c.label}</div>
                    <div className="font-display text-lg text-ink mt-1 break-words [overflow-wrap:anywhere]">
                      {c.value}
                    </div>
                  </div>
                  {c.href && (
                    <FiArrowUpRight className="mt-3 text-ink-soft shrink-0 transition-transform duration-300 group-hover:translate-x-1 group-hover:-translate-y-0.5 group-hover:text-brand-700" />
                  )}
                </a>
              ))}
            </div>

            <div className="mt-12">
              <span className="eyebrow">
                <FiClock size={12} className="!w-3 !h-3" /> Hours
              </span>
              <ul className="mt-5 grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
                {HOURS.map(([day, hours]) => (
                  <li key={day} className="flex justify-between border-b border-surface-line pb-2">
                    <span className="font-display text-ink">{day}</span>
                    <span className="text-ink-muted tabular">{hours}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* RIGHT — form */}
          <div className="lg:col-span-7 order-1 lg:order-2">
            <motion.form
              onSubmit={onSubmit}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-cream-alt rounded-4xl p-7 sm:p-10 lg:p-12 shadow-soft"
            >
              <h3 className="font-display text-2xl sm:text-3xl text-ink">
                Send us a message
              </h3>
              <p className="text-sm text-ink-muted mt-2">
                We respond within one business day. All messages are confidential.
              </p>

              <div className="mt-8 grid sm:grid-cols-2 gap-x-6 gap-y-7">
                <Field name="full_name" label="Full Name" required />
                <Field name="email" label="Email" type="email" required />
                <Field name="phone" label="Phone" type="tel" />
                <Field name="subject" label="Topic" />
              </div>

              <div className="mt-7">
                <label className="eyebrow-bare text-brand-700 text-[11px]">Message</label>
                <textarea
                  name="message"
                  required
                  rows={5}
                  className="mt-2 w-full bg-transparent border-0 border-b border-surface-line focus:border-brand-700 focus:outline-none focus:ring-0 px-0 py-3 text-base text-ink resize-none transition-colors placeholder-ink-soft"
                  placeholder="Tell us a little about what you're looking for…"
                />
              </div>

              <div className="mt-9 flex flex-wrap items-center gap-4">
                <button
                  disabled={state.status === "sending"}
                  className="btn-primary disabled:opacity-60 disabled:hover:translate-y-0"
                >
                  {state.status === "sending" ? "Sending…" : (
                    <>Send message <FiArrowUpRight /></>
                  )}
                </button>

                {state.status === "ok" && (
                  <span className="text-sage-700 text-sm flex items-center gap-2 font-medium">
                    <FiCheck /> Thanks — we received your message.
                  </span>
                )}
                {state.status === "err" && (
                  <span className="text-red-700 text-sm">Sorry — please try again.</span>
                )}
              </div>
            </motion.form>
          </div>
        </div>
      </section>
    </>
  );
}

function Field({ name, label, type = "text", required }: { name: string; label: string; type?: string; required?: boolean }) {
  return (
    <div>
      <label className="eyebrow-bare text-brand-700 text-[11px]">
        {label}{required && <span className="text-brand"> *</span>}
      </label>
      <input
        name={name}
        type={type}
        required={required}
        className="mt-2 w-full bg-transparent border-0 border-b border-surface-line focus:border-brand-700 focus:outline-none focus:ring-0 px-0 py-3 text-base text-ink transition-colors placeholder-ink-soft"
      />
    </div>
  );
}
