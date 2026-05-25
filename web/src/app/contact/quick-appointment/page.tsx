import { FiMapPin, FiPhone, FiMail, FiClock } from "react-icons/fi";
import BookingFlow from "@/components/BookingFlow";

export const metadata = {
  title: "Quick Appointment Request",
  description:
    "Request an appointment in minutes — we'll check your coverage in real time and a care-team member reaches out within one business day.",
};

const HOURS = [
  ["Monday", "8am – 8pm"],
  ["Tuesday", "8am – 8pm"],
  ["Wednesday", "8am – 8pm"],
  ["Thursday", "8am – 8pm"],
  ["Friday", "8am – 6pm"],
  ["Saturday", "9am – 2pm"],
];

export default function QuickAppointmentPage() {
  return (
    <>
      {/* Page header */}
      <section className="bg-cream-alt relative overflow-hidden">
        <div aria-hidden className="absolute inset-0 bg-grid opacity-[0.06]" />
        <div className="container-narrow relative py-20 sm:py-24 lg:py-28 text-center">
          <span className="eyebrow center">Quick Appointment request</span>
          <h1 className="mt-6 display text-5xl sm:text-6xl lg:text-7xl text-ink">
            Let&apos;s get you <span className="italic-accent">started.</span>
          </h1>
          <svg aria-hidden viewBox="0 0 200 8" className="mx-auto mt-7 w-36 h-2 text-brand">
            <path d="M2 5 Q 50 0 100 4 T 198 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <p className="mt-7 text-ink-muted text-lg sm:text-xl leading-relaxed max-w-2xl mx-auto">
            We&apos;ll check your coverage in real time, then a care-team member reaches out within one business day.
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

          {/* RIGHT — booking flow */}
          <div className="lg:col-span-7 order-1 lg:order-2">
            <BookingFlow />
          </div>
        </div>
      </section>
    </>
  );
}
