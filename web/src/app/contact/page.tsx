"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { FiCheck, FiMapPin, FiPhone, FiMail } from "react-icons/fi";

export default function ContactPage() {
  const [state, setState] = useState<{ status: "idle" | "sending" | "ok" | "err"; msg?: string }>({ status: "idle" });

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setState({ status: "sending" });
    const fd = new FormData(e.currentTarget);
    const payload = Object.fromEntries(fd.entries());
    try {
      const r = await fetch("/api/contact", {
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
      <section className="bg-hero-gradient">
        <div className="container-x py-10 sm:py-14 lg:py-16 text-center">
          <span className="text-xs uppercase tracking-[0.2em] text-brand font-semibold">Contact</span>
          <h1 className="mt-2 text-3xl sm:text-4xl md:text-5xl font-bold text-ink">Let's get you matched.</h1>
          <p className="mt-3 text-ink-muted">Tell us a little about what you're looking for — we'll be in touch within one business day.</p>
        </div>
      </section>

      <section className="section !py-10 sm:!py-14 lg:!py-20">
        <div className="container-x grid lg:grid-cols-3 gap-6 lg:gap-8">
          <div className="lg:col-span-2 order-2 lg:order-1">
            <motion.form
              onSubmit={onSubmit}
              initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
              className="bg-white border border-surface-line rounded-2xl p-5 sm:p-6 md:p-8 shadow-soft space-y-4"
            >
              <div className="grid sm:grid-cols-2 gap-4">
                <Field name="full_name" label="Full Name" required />
                <Field name="email" label="Email" type="email" required />
                <Field name="phone" label="Phone" type="tel" />
                <Field name="subject" label="Topic" />
              </div>
              <div>
                <label className="text-sm font-medium text-ink">Message</label>
                <textarea name="message" required rows={5} className="mt-1 w-full px-3 py-2.5 rounded-lg border border-surface-line focus:outline-none focus:border-brand bg-surface-alt text-base" />
              </div>
              <button disabled={state.status === "sending"} className="btn-primary disabled:opacity-60 w-full sm:w-auto py-2.5">
                {state.status === "sending" ? "Sending…" : "Send Message"}
              </button>
              {state.status === "ok" && (
                <div className="text-emerald-600 text-sm flex items-center gap-2"><FiCheck /> Thanks — we received your message.</div>
              )}
              {state.status === "err" && <div className="text-red-600 text-sm">Sorry — please try again.</div>}
            </motion.form>
          </div>

          <aside className="space-y-4 order-1 lg:order-2">
            {[
              { icon: <FiPhone />, label: "Call", value: "725-238-6990", href: "tel:725-238-6990" },
              { icon: <FiMail />, label: "Email", value: "admin@brightertomorrowtherapy.com", href: "mailto:admin@brightertomorrowtherapy.com" },
              { icon: <FiMapPin />, label: "E Russell", value: "3430 E Russell Rd Ste 315, Las Vegas, NV 89120" },
              { icon: <FiMapPin />, label: "N Durango", value: "6955 N Durango Dr Unit 1004, Las Vegas, NV 89149" },
            ].map((c, i) => (
              <a key={i} href={c.href ?? "#"} className="flex items-start gap-3 bg-white border border-surface-line p-4 rounded-2xl hover:border-brand transition min-h-[40px]">
                <span className="text-brand text-lg mt-0.5 flex-shrink-0">{c.icon}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-xs text-ink-muted uppercase tracking-wider">{c.label}</div>
                  <div className="font-display text-ink break-words [overflow-wrap:anywhere]">{c.value}</div>
                </div>
              </a>
            ))}
          </aside>
        </div>
      </section>
    </>
  );
}

function Field({ name, label, type = "text", required }: { name: string; label: string; type?: string; required?: boolean }) {
  return (
    <div>
      <label className="text-sm font-medium text-ink">{label}{required && <span className="text-brand"> *</span>}</label>
      <input name={name} type={type} required={required} className="mt-1 w-full px-3 py-2.5 rounded-lg border border-surface-line focus:outline-none focus:border-brand bg-surface-alt text-base" />
    </div>
  );
}
