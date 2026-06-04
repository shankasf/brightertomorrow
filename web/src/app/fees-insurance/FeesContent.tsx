"use client";

import Link from "next/link";
import Image from "next/image";
import Reveal from "@/components/Reveal";

const WINE = "#66202A";
const GOLD = "#E1B878";
const INK = "#192735";
const CREAM = "#F4F4F4";

const BOOK_HREF = "/contact";

const goldBtn =
  "inline-block font-display font-semibold uppercase text-[13.5px] tracking-[2px] px-[30px] py-[15px] transition hover:opacity-90";
const goldBtnStyle = {
  backgroundColor: GOLD,
  color: INK,
  borderRadius: "20px 0 20px 20px",
} as const;

const headingTight = { letterSpacing: "-1.8px" };

type Rate = { label: string; price: string };

const RATE_GROUPS: { title: string; rows: Rate[] }[] = [
  {
    title: "Individual Therapy",
    rows: [
      { label: "50-minute session with a Licensed Therapist", price: "$150" },
      { label: "With a Pre-Licensed Master's level therapist", price: "$125" },
      { label: "With a Master's Level Student therapist", price: "$25–$60" },
      { label: "5-session package", price: "$150" },
      { label: "10-session package (valid 6 months)", price: "$250" },
    ],
  },
  {
    title: "Couples Therapy",
    rows: [
      { label: "50-minute session with a Licensed Therapist", price: "$180" },
      { label: "75-minute session with a Licensed Therapist", price: "$260" },
      { label: "50-minute with a Pre-Licensed Master's Level Therapist", price: "$150" },
      { label: "75-minute with a Pre-Licensed Master's Level Therapist", price: "$225" },
    ],
  },
  {
    title: "Life Coaching",
    rows: [
      { label: "50-minute session", price: "$75" },
      { label: "6-session package (valid 3 months)", price: "$440" },
    ],
  },
];

const INSURERS: { src: string; name: string }[] = [
  { src: "/images/rates/anthem.jpg", name: "Anthem Blue Cross Blue Shield" },
  { src: "/images/rates/cigna.jpeg", name: "Cigna" },
  { src: "/images/rates/united.png", name: "United Healthcare" },
  { src: "/images/rates/ambetter.jpg", name: "Ambetter / Silver Summit Health Plans" },
  { src: "/images/rates/hpn.jpg", name: "Health Plan of Nevada" },
  { src: "/images/rates/aetna.jpg", name: "Aetna" },
];

const VERIFY_QUESTIONS = [
  "Do I have out-of-network mental health benefits?",
  "Do I have a deductible, and has it been met?",
  "How many sessions per year are covered?",
  "How much will I be reimbursed for an out-of-network provider?",
  "What documentation and submission process is required?",
];

export default function FeesContent() {
  return (
    <article className="bg-white">
      {/* ── HERO ── */}
      <section className="relative overflow-hidden">
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{
            backgroundImage:
              "linear-gradient(rgba(15,22,30,0.62), rgba(15,22,30,0.62)), url('/images/rates/hero-bg.webp')",
          }}
          aria-hidden
        />
        <div className="relative container-x py-28 sm:py-32 text-center">
          <Reveal>
            <h1
              className="font-display font-bold leading-[1.05] text-[40px] sm:text-[52px] lg:text-[60px]"
              style={{ ...headingTight, color: CREAM }}
            >
              <span style={{ color: GOLD }}>Fees</span> &amp; Insurance
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-[17px] leading-[1.6] text-cream/85">
              Navigating the financial aspects of mental health services can be
              complex, but we&rsquo;re here to assist you. Below is a detailed
              guide regarding our fees and insurance policies.
            </p>
          </Reveal>
        </div>
      </section>

      {/* ── CASH RATES ── */}
      <section className="bg-white py-16 lg:py-24">
        <div className="container-x">
          <Reveal>
            <p className="script text-[22px] sm:text-[24.75px]" style={{ color: GOLD }}>
              Transparent pricing
            </p>
            <h2
              className="mt-2 font-display font-bold text-[32px] sm:text-[40px] lg:text-[45px] leading-[1.1]"
              style={{ ...headingTight, color: INK }}
            >
              Cash Rates
            </h2>
          </Reveal>

          <div className="mt-12 grid gap-8 lg:grid-cols-3">
            {RATE_GROUPS.map((group, i) => (
              <Reveal key={group.title} delay={i * 0.1}>
                <div className="h-full overflow-hidden rounded-[18px] border border-cream-deep bg-white shadow-sm">
                  <div
                    className="px-7 py-5"
                    style={{ backgroundColor: WINE }}
                  >
                    <h3 className="font-display font-semibold text-[20px] text-cream">
                      {group.title}
                    </h3>
                  </div>
                  <ul className="divide-y divide-cream-deep px-7">
                    {group.rows.map((row) => (
                      <li
                        key={row.label}
                        className="flex items-baseline justify-between gap-4 py-4"
                      >
                        <span className="text-[15.5px] leading-[1.45] text-ink-soft">
                          {row.label}
                        </span>
                        <span
                          className="shrink-0 font-display font-bold text-[19px]"
                          style={{ color: WINE }}
                        >
                          {row.price}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </Reveal>
            ))}
          </div>

          <Reveal>
            <p className="mt-10 text-center text-[16.5px] leading-[1.5] text-ink-soft">
              If you choose to pay out of pocket, we do accept{" "}
              <strong style={{ color: INK }}>HSA and FSA</strong> cards.
            </p>
          </Reveal>
        </div>
      </section>

      {/* ── INSURANCE / IN-NETWORK ── */}
      <section style={{ backgroundColor: CREAM }} className="py-16 lg:py-24">
        <div className="container-x text-center">
          <Reveal>
            <p className="script text-[22px] sm:text-[24.75px]" style={{ color: GOLD }}>
              Insurance accepted
            </p>
            <h2
              className="mt-2 font-display font-bold text-[32px] sm:text-[40px] lg:text-[45px] leading-[1.1]"
              style={{ ...headingTight, color: INK }}
            >
              In-Network Providers
            </h2>
            <p className="mx-auto mt-5 max-w-2xl text-[16.5px] leading-[1.5] text-ink-soft">
              We are proud to be in-network with the following insurance
              providers:
            </p>
          </Reveal>

          <div className="mx-auto mt-12 grid max-w-4xl grid-cols-2 gap-6 sm:grid-cols-3">
            {INSURERS.map((ins, i) => (
              <Reveal key={ins.name} delay={i * 0.06}>
                <div className="flex h-[120px] items-center justify-center rounded-[14px] bg-white px-6 shadow-sm">
                  <Image
                    src={ins.src}
                    alt={ins.name}
                    width={180}
                    height={80}
                    className="max-h-[72px] w-auto object-contain"
                  />
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── OUT-OF-NETWORK ── */}
      <section className="bg-white py-16 lg:py-24">
        <div className="container-x grid gap-12 lg:grid-cols-2 lg:gap-16">
          <Reveal direction="left">
            <h2
              className="font-display font-bold text-[30px] sm:text-[38px] lg:text-[42px] leading-[1.15]"
              style={{ ...headingTight, color: INK }}
            >
              Out-of-Network Benefits
            </h2>
            <div className="mt-6 space-y-5 text-[16.5px] leading-[1.55] text-ink-soft">
              <p>
                We are an out-of-network provider with many insurance providers.
                Most insurance companies cover a significant portion of the cost
                for &ldquo;out-of-network&rdquo; behavioral health services.
              </p>
              <p>
                Upon request, we can provide you with a monthly invoice that you
                can submit to your insurance company directly for reimbursement.
              </p>
              <p>
                If you choose to use your out-of-network benefits, you will be
                responsible for payment at the time of your session.
              </p>
            </div>
          </Reveal>

          <Reveal direction="right" delay={0.1}>
            <div className="rounded-[18px] bg-cream-alt p-8 sm:p-10">
              <h3
                className="font-display font-bold text-[22px] sm:text-[25px] leading-[1.2]"
                style={{ ...headingTight, color: WINE }}
              >
                Verify your coverage
              </h3>
              <p className="mt-3 text-[15.5px] leading-[1.5] text-ink-soft">
                We recommend asking your insurance provider the following
                questions:
              </p>
              <ol className="mt-6 space-y-4">
                {VERIFY_QUESTIONS.map((q, i) => (
                  <li key={q} className="flex gap-4">
                    <span
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-display font-bold text-[14px] text-cream"
                      style={{ backgroundColor: WINE }}
                    >
                      {i + 1}
                    </span>
                    <span className="text-[15.5px] leading-[1.45] text-ink-soft">
                      {q}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── GOOD FAITH ESTIMATE ── */}
      <section style={{ backgroundColor: WINE }} className="py-20 lg:py-24">
        <div className="container-x">
          <Reveal>
            <div className="mx-auto max-w-4xl rounded-[36px] bg-cream-alt px-6 py-14 sm:px-14">
              <p className="script text-[22px] sm:text-[24.75px]" style={{ color: GOLD }}>
                Your rights &amp; protections
              </p>
              <h3
                className="mt-3 font-display font-bold text-[28px] sm:text-[34px] lg:text-[37.5px] leading-[1.25]"
                style={{ ...headingTight, color: INK }}
              >
                Good Faith Estimate
              </h3>
              <div className="mt-7 space-y-5 text-[16.5px] leading-[1.55] text-ink-soft">
                <p>
                  Under the No Surprises Act, you have the right to receive a
                  &ldquo;Good Faith Estimate&rdquo; explaining how much your
                  health care will cost.
                </p>
                <ul className="list-disc space-y-2 pl-5">
                  <li>
                    You have the right to receive a Good Faith Estimate for the
                    total expected cost of any non-emergency items or services.
                  </li>
                  <li>
                    You can ask for a Good Faith Estimate before you schedule a
                    service, or at any time during treatment.
                  </li>
                  <li>
                    If you receive a bill that is at least $400 more than your
                    Good Faith Estimate, you can dispute the bill.
                  </li>
                  <li>
                    Make sure to save a copy or picture of your Good Faith
                    Estimate.
                  </li>
                </ul>
                <p>
                  For questions or more information about your right to a Good
                  Faith Estimate, visit{" "}
                  <a
                    href="https://www.cms.gov/nosurprises"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline"
                    style={{ color: WINE }}
                  >
                    www.cms.gov/nosurprises
                  </a>{" "}
                  or call 1-800-985-3059.
                </p>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="relative overflow-hidden">
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{
            backgroundImage:
              "linear-gradient(rgba(110,122,138,0.85), rgba(110,122,138,0.85)), url('/images/rates/cta-bg.jpg')",
          }}
          aria-hidden
        />
        <div className="relative container-x py-20 lg:py-24 text-center">
          <Reveal>
            <p className="script text-[22px] sm:text-[24.75px]" style={{ color: GOLD }}>
              Ready to begin your healing journey?
            </p>
            <h3
              className="mt-3 font-display font-bold text-[32px] sm:text-[40px] lg:text-[45px] leading-[1.15]"
              style={{ ...headingTight, color: CREAM }}
            >
              Let us <span style={{ color: GOLD }}>help you</span> or your loved
              one heal. brighter tomorrow!
            </h3>
            <div className="mt-8">
              <Link href={BOOK_HREF} className={goldBtn} style={goldBtnStyle}>
                Consultation Now
              </Link>
            </div>
          </Reveal>
        </div>
      </section>
    </article>
  );
}
