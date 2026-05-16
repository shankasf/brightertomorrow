import Link from "next/link";
import Reveal from "@/components/Reveal";
import { FiArrowUpRight, FiPhone, FiMail, FiHeart } from "react-icons/fi";

export const metadata = {
  title: "Fees & Insurance — Brighter Tomorrow Therapy",
  description:
    "Cash rates, accepted insurance carriers, out-of-network reimbursement, and your Good Faith Estimate rights at Brighter Tomorrow Therapy.",
};

type Row = { label: string; price: string; sub?: string };

const INDIVIDUAL: Row[] = [
  { label: "Licensed Therapist", price: "$150", sub: "50-minute session" },
  { label: "Pre-Licensed Master's Level", price: "$125", sub: "50-minute session" },
  { label: "Master's Level Student", price: "$25 – $60", sub: "50-minute session, pay-what-you-can" },
];

const COUPLES: Row[] = [
  { label: "Licensed Therapist", price: "$180", sub: "50-minute session" },
  { label: "Licensed Therapist", price: "$260", sub: "75-minute session" },
  { label: "Pre-Licensed Master's Level", price: "$150", sub: "50-minute session" },
  { label: "Pre-Licensed Master's Level", price: "$225", sub: "75-minute session" },
];

const COACHING: Row[] = [
  { label: "Life Coaching", price: "$75", sub: "50-minute session" },
  { label: "6-Session Package", price: "$440", sub: "Valid 3 months" },
];

const CARRIERS = [
  "Anthem Blue Cross Blue Shield",
  "Cigna",
  "United Healthcare",
  "Ambetter / Silver Summit Health Plans",
  "Health Plan of Nevada",
  "Aetna",
];

function RateTable({ rows }: { rows: Row[] }) {
  return (
    <ul className="divide-y divide-surface-line border-y border-surface-line">
      {rows.map((r, i) => (
        <li key={i} className="flex items-baseline justify-between gap-6 py-4">
          <div className="min-w-0">
            <div className="font-display text-base sm:text-lg text-ink leading-snug">
              {r.label}
            </div>
            {r.sub && (
              <div className="text-sm text-ink-soft mt-1 leading-relaxed">{r.sub}</div>
            )}
          </div>
          <div className="shrink-0 font-display text-xl sm:text-2xl text-brand-700 tabular">
            {r.price}
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function RatesPage() {
  return (
    <>
      {/* Page header */}
      <section className="bg-cream-alt relative overflow-hidden">
        <div aria-hidden className="absolute inset-0 bg-grid opacity-[0.06]" />
        <div className="container-narrow relative py-20 sm:py-28 lg:py-32 text-center">
          <span className="eyebrow center">Fees &amp; Insurance</span>
          <h1 className="mt-6 display text-5xl sm:text-6xl lg:text-7xl text-ink">
            Transparent <span className="italic-accent">rates.</span>
          </h1>
          <svg aria-hidden viewBox="0 0 200 8" className="mx-auto mt-7 w-36 h-2 text-brand">
            <path d="M2 5 Q 50 0 100 4 T 198 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <p className="mt-7 text-ink-muted text-lg sm:text-xl leading-relaxed max-w-2xl mx-auto">
            Cash-pay rates, in-network insurance, and out-of-network reimbursement — all in one place.
          </p>
        </div>
      </section>

      {/* Affordable-therapy banner */}
      <section className="bg-white border-b border-surface-line">
        <div className="container-x py-5">
          <Link
            href="/affordable-therapy"
            className="group flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-3xl border border-brand-200 bg-brand-50 px-5 sm:px-7 py-4 hover:border-brand-700/40 hover:bg-brand-100/60 transition"
          >
            <div className="flex items-start sm:items-center gap-4">
              <span className="shrink-0 w-10 h-10 rounded-full bg-brand/15 text-brand-700 grid place-items-center">
                <FiHeart />
              </span>
              <div>
                <div className="eyebrow-bare text-brand-700 text-[11px]">Need a lower-cost option?</div>
                <div className="font-display text-ink text-base sm:text-lg mt-1">
                  Learn about our affordable therapy program — sessions from $25.
                </div>
              </div>
            </div>
            <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-brand-700 sm:shrink-0">
              Explore
              <FiArrowUpRight className="transition-transform duration-300 group-hover:translate-x-1 group-hover:-translate-y-0.5" />
            </span>
          </Link>
        </div>
      </section>

      {/* Section 1 — Cash Rates */}
      <section className="section bg-white">
        <div className="container-x">
          <Reveal>
            <div className="max-w-2xl">
              <span className="eyebrow">Cash rates</span>
              <h2 className="mt-5 display text-4xl sm:text-5xl text-ink leading-[1.05]">
                Pay-per-session <span className="italic-accent">pricing.</span>
              </h2>
              <p className="mt-5 text-ink-muted leading-relaxed">
                Straightforward rates for clients paying out-of-pocket or using HSA/FSA. No surprises.
              </p>
            </div>
          </Reveal>

          <div className="mt-12 grid lg:grid-cols-3 gap-6 lg:gap-8">
            <Reveal>
              <article className="h-full rounded-4xl border border-surface-line bg-cream p-7 lg:p-8 shadow-soft">
                <header className="flex items-baseline justify-between gap-4 pb-5 border-b border-surface-line">
                  <h3 className="font-display text-xl text-ink">Individual Therapy</h3>
                  <span className="text-xs uppercase tracking-[0.18em] text-brand-700 font-semibold">50 min</span>
                </header>
                <div className="mt-5">
                  <RateTable rows={INDIVIDUAL} />
                </div>
                <div className="mt-6 rounded-2xl bg-white border border-surface-line p-5">
                  <div className="eyebrow-bare text-brand-700 text-[11px]">Package options</div>
                  <ul className="mt-3 space-y-2 text-sm text-ink leading-relaxed">
                    <li className="flex justify-between gap-4">
                      <span>5 sessions</span>
                      <span className="font-display text-brand-700 tabular">$150</span>
                    </li>
                    <li className="flex justify-between gap-4">
                      <span>10 sessions</span>
                      <span className="font-display text-brand-700 tabular">$250</span>
                    </li>
                  </ul>
                  <div className="mt-3 text-xs text-ink-soft">Valid 6 months from purchase.</div>
                </div>
              </article>
            </Reveal>

            <Reveal delay={0.05}>
              <article className="h-full rounded-4xl border border-surface-line bg-cream p-7 lg:p-8 shadow-soft">
                <header className="flex items-baseline justify-between gap-4 pb-5 border-b border-surface-line">
                  <h3 className="font-display text-xl text-ink">Couples Therapy</h3>
                  <span className="text-xs uppercase tracking-[0.18em] text-brand-700 font-semibold">50 / 75 min</span>
                </header>
                <div className="mt-5">
                  <RateTable rows={COUPLES} />
                </div>
              </article>
            </Reveal>

            <Reveal delay={0.1}>
              <article className="h-full rounded-4xl border border-surface-line bg-cream p-7 lg:p-8 shadow-soft">
                <header className="flex items-baseline justify-between gap-4 pb-5 border-b border-surface-line">
                  <h3 className="font-display text-xl text-ink">Life Coaching</h3>
                  <span className="text-xs uppercase tracking-[0.18em] text-brand-700 font-semibold">50 min</span>
                </header>
                <div className="mt-5">
                  <RateTable rows={COACHING} />
                </div>
                <div className="mt-6 text-xs text-ink-soft leading-relaxed">
                  Package valid 3 months from purchase.
                </div>
              </article>
            </Reveal>
          </div>

          <p className="mt-10 text-sm text-ink-soft leading-relaxed">
            Payment methods include HSA and FSA cards.
          </p>
        </div>
      </section>

      {/* Section 2 — In-Network Insurance */}
      <section className="section bg-cream-alt">
        <div className="container-x">
          <Reveal>
            <div className="max-w-2xl">
              <span className="eyebrow">Insurance Networks</span>
              <h2 className="mt-5 display text-4xl sm:text-5xl text-ink leading-[1.05]">
                We&apos;re in-network <span className="italic-accent">with major carriers.</span>
              </h2>
              <p className="mt-5 text-ink-muted leading-relaxed">
                Bring your insurance card to intake and we&apos;ll verify your benefits before your first session.
              </p>
            </div>
          </Reveal>

          <ul className="mt-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {CARRIERS.map((name, i) => (
              <Reveal key={name} delay={i * 0.03}>
                <li className="h-full flex items-center gap-4 bg-white rounded-3xl border border-surface-line px-5 py-5 shadow-soft hover:border-brand-700/40 transition">
                  <span aria-hidden className="shrink-0 w-10 h-10 rounded-full bg-brand/15 text-brand-700 grid place-items-center font-display text-sm tabular">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="font-display text-ink text-base sm:text-lg leading-snug">
                    {name}
                  </span>
                </li>
              </Reveal>
            ))}
          </ul>
        </div>
      </section>

      {/* Section 3 — Out-of-Network */}
      <section className="section bg-white">
        <div className="container-x grid lg:grid-cols-12 gap-10 lg:gap-16 items-start">
          <Reveal className="lg:col-span-5">
            <span className="eyebrow">Out-of-Network Coverage</span>
            <h2 className="mt-5 display text-4xl sm:text-5xl text-ink leading-[1.05]">
              Don&apos;t see your <span className="italic-accent">carrier?</span>
            </h2>
          </Reveal>
          <Reveal delay={0.05} className="lg:col-span-7">
            <p className="text-ink-muted text-lg leading-relaxed">
              Most insurance companies cover a significant portion of the cost for &ldquo;out of network&rdquo; behavioral health services.
              We provide monthly invoices for clients to submit for reimbursement.
            </p>
          </Reveal>
        </div>
      </section>

      {/* Section 4 — Good Faith Estimate */}
      <section className="section bg-cream">
        <div className="container-narrow">
          <Reveal>
            <div className="rounded-4xl bg-white border border-surface-line p-8 sm:p-10 lg:p-12 shadow-soft">
              <span className="eyebrow">Your rights</span>
              <h2 className="mt-5 display text-3xl sm:text-4xl text-ink leading-[1.1]">
                Your Right to a <span className="italic-accent">Good Faith Estimate.</span>
              </h2>
              <p className="mt-6 text-ink-muted text-lg leading-relaxed">
                Patients may request cost estimates and dispute bills exceeding estimates by $400 or more.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <a
                  href="https://www.cms.gov/nosurprises"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-ghost"
                >
                  www.cms.gov/nosurprises <FiArrowUpRight />
                </a>
                <a href="tel:1-800-985-3059" className="btn-ghost">
                  <FiPhone /> 1-800-985-3059
                </a>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* Section 5 — Contact strip */}
      <section className="bg-ink text-white">
        <div className="container-x py-14 sm:py-16 grid lg:grid-cols-12 gap-8 lg:gap-12 items-center">
          <div className="lg:col-span-7">
            <span className="eyebrow">Questions?</span>
            <h2 className="mt-4 display text-3xl sm:text-4xl text-white leading-[1.1]">
              We&apos;ll verify your <span className="italic-accent">benefits.</span>
            </h2>
            <p className="mt-4 text-white/80 leading-relaxed max-w-xl">
              Call or email and we&apos;ll walk you through what your plan covers — before you commit to anything.
            </p>
          </div>
          <div className="lg:col-span-5 flex flex-col sm:flex-row lg:flex-col gap-4 lg:items-end">
            <a
              href="tel:725-238-6990"
              className="group inline-flex items-center gap-3 text-white hover:text-brand transition"
            >
              <span className="w-10 h-10 rounded-full bg-white/10 grid place-items-center group-hover:bg-brand group-hover:text-ink transition">
                <FiPhone />
              </span>
              <span className="font-display text-lg sm:text-xl">725-238-6990</span>
            </a>
            <a
              href="mailto:admin@brightertomorrowtherapy.com"
              className="group inline-flex items-center gap-3 text-white hover:text-brand transition break-all"
            >
              <span className="w-10 h-10 rounded-full bg-white/10 grid place-items-center group-hover:bg-brand group-hover:text-ink transition shrink-0">
                <FiMail />
              </span>
              <span className="font-display text-base sm:text-lg">admin@brightertomorrowtherapy.com</span>
            </a>
            <Link href="/contact" className="btn-primary mt-2 lg:mt-4">
              Book an appointment <FiArrowUpRight />
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
