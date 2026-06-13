"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { motion, AnimatePresence } from "framer-motion";
import Reveal from "@/components/Reveal";
import { FiChevronDown } from "react-icons/fi";

const WINE = "#66202A";
const GOLD = "#E1B878";
const INK = "#192735";
const CREAM = "#F4F4F4";

const BOOK_HREF = "/contact";

// Brand button: gold fill, ink text, asymmetric brand radius, wide tracking.
const goldBtn =
  "inline-block font-display font-semibold uppercase text-[13.5px] tracking-[2px] px-[30px] py-[15px] transition hover:opacity-90";

type Faq = { q: string; body: React.ReactNode };

const FAQS: Faq[] = [
  {
    q: "Types of Services provided",
    body: (
      <>
        <p>
          Clinical Interns provide 2-free Counseling sessions to you, your child,
          or teen! Then, we offer &ldquo;pay what you can&rdquo; sessions. During
          your intake call with our admin you will discuss your fee rate between
          $20-$60 or the package rate.
        </p>
        <p>
          Under supervision, the Clinical Student Intern, will work with you and
          your family to determine your treatment needs and provide therapeutic
          techniques to help you reduce or manage your mental health concerns.
        </p>
      </>
    ),
  },
  {
    q: "How do I qualify for Free Therapy?",
    body: (
      <>
        <ul className="list-disc pl-5 space-y-1">
          <li>I do not have insurance.</li>
          <li>I can not afford full.</li>
          <li>
            My family does not have insurance and cannot afford to pay
            out-of-pocket for services.
          </li>
          <li>I am waiting on my insurance to be eligible for services.</li>
        </ul>
        <p>
          If you are interested or have further questions, please call our main
          office at 725-238-6990.
        </p>
      </>
    ),
  },
  {
    q: "How long are the therapy sessions?",
    body: (
      <>
        <p>
          All sessions with a practicum student are 45-55 minutes in length,
          similar to standard therapy sessions. If you prefer longer sessions, we
          offer an extended option at a 10% increased rate.
        </p>
        <p>
          Please note that practicum students are still in training and completing
          their graduate education. As such, their availability is limited to
          their practicum period, which typically lasts 3-4 months. Once their
          practicum ends, therapy services with that student will conclude. If the
          student continues their training toward licensure at our practice, you
          may have the option to work with them in a different capacity.
        </p>
      </>
    ),
  },
  {
    q: "Do you charged for missed sessions?",
    body: (
      <>
        <p>
          We kindly remind you that a $50 fee will be charged for any missed
          sessions, including within the first two free sessions. It&rsquo;s
          important to inform us if you&rsquo;re unable to attend your scheduled
          appointment, as our interns rely on these sessions to complete their
          required hours and provide quality care.
        </p>
        <p>
          If you need to cancel or reschedule, please contact our office directly
          at 725-238-6990 within 24 hours of your appointment. We appreciate your
          understanding and cooperation in helping us maintain a smooth and
          efficient practice for everyone.
        </p>
      </>
    ),
  },
];

const headingTight = { letterSpacing: "-1.8px" };

function Accordion() {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div className="space-y-4">
      {FAQS.map((item, i) => {
        const isOpen = open === i;
        return (
          <div
            key={item.q}
            className="overflow-hidden rounded-[10px]"
            style={{ backgroundColor: WINE }}
          >
            <button
              type="button"
              onClick={() => setOpen(isOpen ? null : i)}
              className="flex w-full items-center justify-between gap-4 px-6 py-[18px] text-left"
            >
              <span className="font-display font-semibold text-[15px] text-cream">
                {item.q}
              </span>
              <motion.span
                animate={{ rotate: isOpen ? 180 : 0 }}
                transition={{ duration: 0.3 }}
                className="shrink-0 text-cream/90"
              >
                <FiChevronDown size={18} />
              </motion.span>
            </button>
            <AnimatePresence initial={false}>
              {isOpen && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
                >
                  <div className="space-y-3 bg-cream px-6 py-5 text-[15px] leading-[1.6] text-ink-soft">
                    {item.body}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}

/** Photo in an asymmetric brand frame with an offset wine card behind it. */
function FramedPhoto({
  src,
  alt,
  offset,
}: {
  src: string;
  alt: string;
  offset: "left" | "right";
}) {
  const radius = "8px 70px 8px 70px";
  return (
    <div className="relative mx-auto w-full max-w-[520px]">
      <div
        className={`absolute -bottom-6 h-full w-full ${
          offset === "left" ? "-left-6" : "-right-6"
        }`}
        style={{ backgroundColor: WINE, borderRadius: radius }}
        aria-hidden
      />
      <div
        className="relative overflow-hidden"
        style={{ borderRadius: radius }}
      >
        <Image
          src={src}
          alt={alt}
          width={520}
          height={520}
          className="h-full w-full object-cover"
        />
      </div>
    </div>
  );
}

export default function RatesContent() {
  return (
    <article className="bg-white">
      {/* ── HERO ── */}
      <section className="relative overflow-hidden">
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{
            backgroundImage:
              "linear-gradient(rgba(15,22,30,0.62), rgba(15,22,30,0.62)), url('/images/rates/affordable/hero.webp')",
          }}
          aria-hidden
        />
        <div className="relative container-x py-28 sm:py-32 text-center">
          <Reveal>
            <h1
              className="font-display font-bold leading-[1.05] text-[40px] sm:text-[52px] lg:text-[60px]"
              style={{ ...headingTight, color: CREAM }}
            >
              <span style={{ color: GOLD }}>Affordable Therapy</span> in Las
              Vegas, NV
            </h1>
          </Reveal>
        </div>
      </section>

      {/* ── LOW COST intro + photo ── */}
      <section className="bg-white py-16 lg:py-24 overflow-hidden">
        <div className="container-x grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
          <Reveal direction="left">
            <h2
              className="font-display font-bold text-[30px] sm:text-[38px] lg:text-[45px] leading-[1.15]"
              style={{ ...headingTight, color: INK }}
            >
              We offer LOW COST therapy in Las Vegas, NV
            </h2>
            <p
              className="mt-5 font-display font-semibold text-[20px] sm:text-[22.5px] leading-[1.2]"
              style={{ ...headingTight, color: WINE }}
            >
              Many people are often unable to obtain mental health services due to
              lack of insurance and high out of pocket cost.
            </p>
            <p
              className="mt-5 font-display font-semibold text-[18px] leading-[1.3]"
              style={{ color: WINE }}
            >
              Then &ldquo;pay what you can program&rdquo; offering sessions between
              $25-$60 each. Or Pay for a 5 session package for $150 or 10 sessions
              for $250. Packages last for 6 months
            </p>
            <div className="mt-6 space-y-5 text-[16.5px] leading-[1.5] text-ink-soft">
              <p>
                At Brighter Tomorrow. it&rsquo;s important to us that everyone has
                access to affordable therapy services.
              </p>
              <p>
                Through our counseling internship student program, we are able to
                make this a reality and offer low cost for therapy sessions. These
                are full length, 50 minute long sessions that will help get you or
                your loved one to a better mental state. We offer both in person
                sessions at our office in Las Vegas or virtually throughout all of
                Nevada.
              </p>
              <p>
                Learn more about our process and our Master&rsquo;s level students
                below, then click to schedule an intake and get started!
              </p>
              <p>
                Our Master&rsquo;s level students do not take insurance and can not
                provide reimbursement for insurance.
              </p>
            </div>
            <div className="mt-8">
              <Link
                href={BOOK_HREF}
                className={goldBtn}
                style={{
                  backgroundColor: GOLD,
                  color: INK,
                  borderRadius: "20px 0 20px 20px",
                }}
              >
                Book an Appointment
              </Link>
            </div>
          </Reveal>

          <Reveal direction="right" delay={0.1}>
            <FramedPhoto
              src="/images/rates/affordable/man-therapy.jpg"
              alt="Person undergoing therapy"
              offset="left"
            />
          </Reveal>
        </div>
      </section>

      {/* ── FAQs + photo ── */}
      <section className="bg-white py-16 lg:py-24 overflow-hidden">
        <div className="container-x grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
          <Reveal direction="left">
            <FramedPhoto
              src="/images/rates/affordable/young-person.jpg"
              alt="Young person in a therapy session"
              offset="left"
            />
          </Reveal>

          <Reveal direction="right" delay={0.1}>
            <h2
              className="font-display font-bold text-[34px] sm:text-[40px] lg:text-[45px] leading-[1.1]"
              style={{ ...headingTight, color: INK }}
            >
              FAQs
            </h2>
            <div className="mt-7">
              <Accordion />
            </div>
            <div className="mt-7">
              <Link
                href={BOOK_HREF}
                className={goldBtn}
                style={{
                  backgroundColor: GOLD,
                  color: INK,
                  borderRadius: "20px 0 20px 20px",
                }}
              >
                Meet Your Student Therapist
              </Link>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── Internship program + schedule band (wine) ── */}
      <section style={{ backgroundColor: WINE }} className="py-20 lg:py-24">
        <div className="container-x">
          {/* Cream card */}
          <Reveal>
            <div className="mx-auto max-w-4xl rounded-[36px] bg-cream-alt px-6 py-14 text-center sm:px-14">
              <p
                className="script text-[22px] sm:text-[24.75px]"
                style={{ color: GOLD }}
              >
                Clinical Internship Program
              </p>
              <h3
                className="mt-3 font-display font-bold text-[28px] sm:text-[34px] lg:text-[37.5px] leading-[1.25]"
                style={{ ...headingTight, color: INK }}
              >
                Our Clinical Internship Program
              </h3>
              <div className="mx-auto mt-7 max-w-2xl space-y-6 text-[16.5px] leading-[1.5] text-ink-soft">
                <p>
                  The Clinical Student Internship Program is for Graduate degree
                  students who are in their practicum courses in their
                  Master&rsquo;s degree program.
                </p>
                <p>
                  The Clinical Student Internship offers Master-level students the
                  opportunity to earn their practicum hours toward their degree and
                  graduation.
                </p>
                <p>
                  We accept Graduate Student Interns pursuing their Master&rsquo;s
                  degree in Clinical Mental Health Counseling.
                </p>
              </div>
            </div>
          </Reveal>

          {/* Schedule band */}
          <div className="mt-20 grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
            <Reveal direction="left">
              <p
                className="font-display font-semibold text-[20px] sm:text-[22.5px] leading-[1.2]"
                style={{ color: GOLD }}
              >
                Schedule your therapy intake session here! We are ready to help
                support you or your family.
              </p>
              <h3
                className="mt-4 font-display font-bold text-[34px] sm:text-[40px] lg:text-[45px] leading-[1.1]"
                style={{ ...headingTight, color: CREAM }}
              >
                Ready to schedule for Free Therapy?
              </h3>
              <div className="mt-7">
                <Link
                  href={BOOK_HREF}
                  className={goldBtn}
                  style={{
                    backgroundColor: GOLD,
                    color: INK,
                    borderRadius: "20px 0 20px 20px",
                  }}
                >
                  Book an Appointment
                </Link>
              </div>
            </Reveal>

            <Reveal direction="right" delay={0.1}>
              <div className="space-y-6 text-[18px] leading-[1.5] text-white">
                <p>
                  After scheduling please check your email for a link to complete
                  additional forms. Please also check your spam folder. All forms
                  must be completed 72 hours BEFORE session to allow time to review.
                  If not complete session will be cancelled and rescheduled.
                </p>
                <p>We look forward to meeting you!</p>
                <p>~ Therapy for Brighter Tomorrow Counseling.</p>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ── Healing journey CTA ── */}
      <section className="relative overflow-hidden">
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{
            backgroundImage:
              "linear-gradient(rgba(110,122,138,0.85), rgba(110,122,138,0.85)), url('/images/rates/affordable/cta-bg.jpg')",
          }}
          aria-hidden
        />
        <div className="relative container-x py-20 lg:py-24 text-center">
          <Reveal>
            <p
              className="script text-[22px] sm:text-[24.75px]"
              style={{ color: GOLD }}
            >
              Ready to begin your healing journey?
            </p>
            <h3
              className="mt-3 font-display font-bold text-[32px] sm:text-[40px] lg:text-[45px] leading-[1.15]"
              style={{ ...headingTight, color: CREAM }}
            >
              Let us <span style={{ color: GOLD }}>help you</span> or your loved one
              heal. brighter tomorrow!
            </h3>
            <div className="mt-8">
              <Link
                href={BOOK_HREF}
                className={goldBtn}
                style={{
                  backgroundColor: GOLD,
                  color: INK,
                  borderRadius: "20px 0 20px 20px",
                }}
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
