"use client";

import Link from "next/link";
import Image from "next/image";
import { motion } from "framer-motion";
import Reveal from "@/components/Reveal";
import { FiCheck } from "react-icons/fi";

const WINE = "#66202A";
const GOLD = "#E1B878";
const INK = "#192735";

const INDIVIDUAL = [
  "$150 for 50 minute session with a Licensed Therapists",
  "$125 with a Pre-Licensed Master’s level therapist",
  "$25-$60 with a Masters Level Student Or Pay for a 5-session package for $150 or 10 sessions for $250. Packages last for 6 months",
];

const COUPLES = [
  "$180 for 50 minute session with a Licensed Therapist",
  "$260 for a 75 minute session with a Licensed Therapist",
  "$150 for a 50 minute session with a Pre-Licensed Master’s Level Therapist",
  "$225 for a 75 minute session with a Pre-Licensed Master’s Level Therapist",
];

const COACHING = [
  "$75 for 50 minute sessions",
  "6- 50minute Session package for $440. Package last for 3 months",
];

const INSURERS: { src: string; alt: string }[] = [
  { src: "/images/rates/anthem.jpg", alt: "Anthem Blue Cross Blue Shield" },
  { src: "/images/rates/cigna.jpeg", alt: "Cigna" },
  { src: "/images/rates/united.png", alt: "United Healthcare" },
  { src: "/images/rates/ambetter.jpg", alt: "Ambetter / Silver Summit Health Plans" },
  { src: "/images/rates/hpn.jpg", alt: "Health Plan of Nevada" },
  { src: "/images/rates/aetna.jpg", alt: "Aetna" },
  { src: "/images/rates/tricare.jpg", alt: "TRICARE" },
];

const VERIFY_Q = [
  { lead: "Out-of-Network (OON) Benefits:", rest: "Do I have OON mental health benefits?" },
  { lead: "Deductible:", rest: "Do I have a deductible and has it been met?" },
  { lead: "Session Coverage:", rest: "How many sessions per year are covered?" },
  { lead: "Reimbursement:", rest: "How much will I be reimbursed for out-of-network providers?" },
  { lead: "Claim Submission:", rest: "What is the required documentation and how do I submit claims?" },
];

const goldBtn =
  "inline-block font-display font-bold tracking-[0.15em] text-[13px] uppercase px-8 py-4 transition hover:opacity-90";

export default function RatesPage() {
  return (
    <article className="bg-white">
      {/* HERO */}
      <section className="relative overflow-hidden">
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{
            backgroundImage:
              "linear-gradient(rgba(15,22,30,0.55), rgba(15,22,30,0.55)), url('/images/rates/hero-bg.webp')",
          }}
          aria-hidden
        />
        <div className="relative container-x py-28 sm:py-36 lg:py-44 text-center">
          <Reveal>
            <h1
              className="font-display font-bold leading-tight text-[40px] sm:text-[52px] lg:text-[60px]"
              style={{ color: "#F4F4F4" }}
            >
              <span style={{ color: GOLD }}>Fees</span> &amp; Insurance
            </h1>
          </Reveal>
        </div>
      </section>

      {/* SECTION 2 — Our Fees & Insurance intro */}
      <section className="bg-white">
        <div className="container-narrow py-16 lg:py-20 text-center">
          <Reveal>
            <h2
              className="font-display font-bold text-[28px] sm:text-[34px] lg:text-[37.5px]"
              style={{ color: INK }}
            >
              Our Fees &amp; Insurance
            </h2>
            <p className="mt-6 text-[16px] leading-[1.8] text-ink-soft max-w-2xl mx-auto">
              Navigating the financial aspects of mental health services can be complex,
              but we&rsquo;re here to assist you. Below is a detailed guide regarding our
              fees and insurance policies.
            </p>
          </Reveal>
        </div>
      </section>

      {/* SECTION 3 — Cash Rates (white bg, three category lists stacked, dark text) */}
      <section className="bg-white pb-16 lg:pb-20">
        <div className="container-narrow">
          <Reveal>
            <h3
              className="text-center font-display font-bold text-[28px] sm:text-[34px] lg:text-[37.5px]"
              style={{ color: INK }}
            >
              Cash Rates
            </h3>
          </Reveal>

          <div className="mt-10 space-y-10">
            {[
              { title: "Individual Therapy:", items: INDIVIDUAL },
              { title: "Couples Therapy:", items: COUPLES },
              { title: "Life Coaching:", items: COACHING },
            ].map((col, i) => (
              <Reveal key={col.title} delay={i * 0.08}>
                <div>
                  <h4
                    className="font-display font-bold text-[20px] sm:text-[22px] mb-4"
                    style={{ color: WINE }}
                  >
                    {col.title}
                  </h4>
                  <ul className="space-y-3">
                    {col.items.map((line) => (
                      <li
                        key={line}
                        className="flex items-start gap-3 text-[15px] leading-[1.75] text-ink-soft"
                      >
                        <FiCheck
                          className="mt-1 shrink-0"
                          style={{ color: WINE }}
                          size={18}
                          strokeWidth={2.5}
                        />
                        <span>{line}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </Reveal>
            ))}
          </div>

          <Reveal delay={0.2}>
            <p className="mt-12 text-center text-[15px] leading-[1.7] text-ink-soft max-w-3xl mx-auto">
              If you choose to pay out of pocket, we do accept HSA and FSA cards.
              <br />
              If you have more questions about this, please don&rsquo;t hesitate to{" "}
              <Link
                href="/contact"
                className="underline decoration-1 underline-offset-4 hover:opacity-80"
                style={{ color: WINE }}
              >
                contact us.
              </Link>
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-4">
              <Link
                href="/contact"
                className={goldBtn}
                style={{
                  backgroundColor: WINE,
                  color: "#fff",
                  borderRadius: "30px 0 30px 30px",
                }}
              >
                Book Your Session Here
              </Link>
              <Link
                href="/contact"
                className={goldBtn}
                style={{
                  backgroundColor: "transparent",
                  color: WINE,
                  borderRadius: "30px 0 30px 30px",
                  border: `2px solid ${WINE}`,
                }}
              >
                Contact Us
              </Link>
            </div>
          </Reveal>
        </div>
      </section>

      {/* SECTION 4 — Insurance Coverage */}
      <section className="bg-white py-20 lg:py-24">
        <div className="container-x">
          <Reveal>
            <h3
              className="text-center font-display font-bold text-[28px] sm:text-[34px] lg:text-[37.5px]"
              style={{ color: INK }}
            >
              Insurance Coverage
            </h3>
            <p className="mt-6 text-center text-[16px] leading-[1.8] text-ink-soft">
              We are currently in-network with the following insurance providers:
            </p>
          </Reveal>

          <div className="mt-14 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-10 gap-y-12 items-center justify-items-center max-w-5xl mx-auto">
            {INSURERS.map((logo, i) => (
              <Reveal key={logo.alt} delay={i * 0.05}>
                <motion.div
                  whileHover={{ scale: 1.04 }}
                  transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                  className="relative w-full max-w-[180px] aspect-[16/9]"
                >
                  <Image
                    src={logo.src}
                    alt={logo.alt}
                    fill
                    sizes="180px"
                    className="object-contain"
                  />
                </motion.div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* SECTION 5 — Out-of-Network Providers */}
      <section className="bg-cream-alt py-20 lg:py-24">
        <div className="container-narrow">
          <Reveal>
            <h3
              className="text-center font-display font-bold text-[28px] sm:text-[34px] lg:text-[37.5px]"
              style={{ color: INK }}
            >
              Out-of-Network Providers
            </h3>
            <p className="mt-6 text-[16px] leading-[1.8] text-ink-soft">
              We are an out-of-network provider with many insurance providers. Most insurance
              companies cover a significant portion of the cost for &ldquo;out of network&rdquo;
              behavioral health services. You will be required to pay for services and request
              reimbursement from your provider.
            </p>
            <p className="mt-5 text-[16px] leading-[1.8] text-ink-soft">
              <span className="font-semibold text-ink">Reimbursement:</span>{" "}
              Upon request, we can provide you with a monthly invoice that you can submit to
              your insurance company directly for reimbursement.
            </p>
            <p className="mt-5 text-[16px] leading-[1.8] text-ink-soft">
              <span className="font-semibold text-ink">Payment:</span>{" "}
              If you choose to use your out-of-network benefits, you will be responsible for
              payment at the time of your session.
            </p>
          </Reveal>
        </div>
      </section>

      {/* SECTION 6 — Verifying Your Coverage */}
      <section className="bg-white py-20 lg:py-24">
        <div className="container-narrow">
          <Reveal>
            <h3
              className="text-center font-display font-bold text-[28px] sm:text-[34px] lg:text-[37.5px]"
              style={{ color: INK }}
            >
              Verifying Your Coverage
            </h3>
            <p className="mt-6 text-[16px] leading-[1.8] text-ink-soft">
              Please call your insurance provider to verify out-of-network coverage for
              outpatient mental (behavioral) health services by asking these questions.
            </p>
            <ul className="mt-8 space-y-5">
              {VERIFY_Q.map((q, i) => (
                <motion.li
                  key={q.lead}
                  initial={{ opacity: 0, x: -16 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true, amount: 0.3 }}
                  transition={{ duration: 0.5, delay: i * 0.05 }}
                  className="flex items-start gap-3 text-[16px] leading-[1.7] text-ink-soft"
                >
                  <FiCheck className="mt-1 shrink-0" size={18} strokeWidth={2.5} style={{ color: WINE }} />
                  <span>
                    <span className="font-semibold text-ink">{q.lead}</span> {q.rest}
                  </span>
                </motion.li>
              ))}
            </ul>
          </Reveal>

          <Reveal delay={0.15}>
            <div className="mt-10 flex flex-wrap justify-center gap-4">
              <Link
                href="/contact"
                className={goldBtn}
                style={{
                  backgroundColor: WINE,
                  color: "#fff",
                  borderRadius: "30px 0 30px 30px",
                }}
              >
                Book Your Session Here
              </Link>
              <Link
                href="/contact"
                className={goldBtn}
                style={{
                  backgroundColor: "transparent",
                  color: WINE,
                  borderRadius: "30px 0 30px 30px",
                  border: `2px solid ${WINE}`,
                }}
              >
                Contact Us
              </Link>
            </div>
            <p className="mt-10 text-center text-[15px] leading-[1.7] text-ink-soft italic">
              For any further inquiries or clarification regarding our fees and insurance
              policies, please contact our office.
            </p>
          </Reveal>
        </div>
      </section>

      {/* SECTION 7 — Good Faith Estimate */}
      <section className="bg-cream-alt py-20 lg:py-24">
        <div className="container-narrow">
          <Reveal>
            <h2
              className="text-center font-display font-bold text-[28px] sm:text-[34px] lg:text-[37.5px]"
              style={{ color: INK }}
            >
              Good Faith Estimate
            </h2>
            <div className="mt-8 space-y-5 text-[16px] leading-[1.8] text-ink-soft">
              <p>
                You have the right to receive a &ldquo;Good Faith Estimate&rdquo; explaining
                how much your health care will cost.
              </p>
              <p>
                Under the law, Health care providers need to give patients who do not have
                insurance or who are not using insurance an estimate of the bill for medical
                items and services. This is called a Good Faith Estimate.
              </p>
              <p>
                You have the right to receive a Good Faith Estimate for total expected cost of
                any health care items of services. The Good Faith Estimate shows the total
                expected cost of any non-emergency items or services and equipment.
              </p>
              <p>
                You may request a Good Faith Estimate in advance of an already scheduled
                health care service or item, or before scheduling an item or service.
              </p>
              <p>
                If you receive a bill that is at least $400 more than your Good Faith
                Estimate, you can dispute the bill.
              </p>
              <p>Make sure to save a copy or picture of your Good Faith Estimate.</p>
              <p>
                For questions or more information about your right to a Good Faith Estimate
                or the dispute process, visit{" "}
                <a
                  href="https://www.cms.gov/nosurprises"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline decoration-1 underline-offset-4 hover:opacity-80"
                  style={{ color: WINE }}
                >
                  www.cms.gov/nosurprises
                </a>{" "}
                or call 1.800.985.3059.
              </p>
            </div>
          </Reveal>
        </div>
      </section>

      {/* SECTION 8 — Healing journey CTA banner */}
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
            <p
              className="font-script italic text-[20px] sm:text-[24px]"
              style={{ color: GOLD }}
            >
              Ready to begin your healing journey?
            </p>
            <h3 className="mt-3 font-display font-bold text-[32px] sm:text-[40px] lg:text-[45px] text-white leading-[1.15]">
              Take the first step on the path toward a{" "}
              <span style={{ color: GOLD }}>brighter tomorrow</span>!
            </h3>
            <div className="mt-8">
              <Link
                href="/contact"
                className={goldBtn}
                style={{ backgroundColor: GOLD, color: INK, borderRadius: "30px 0 30px 30px" }}
              >
                Consultation Now
              </Link>
            </div>
          </Reveal>
        </div>
      </section>
    </article>
  );
}
