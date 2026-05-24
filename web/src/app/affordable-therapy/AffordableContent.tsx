"use client";

import Link from "next/link";
import Image from "next/image";
import { motion } from "framer-motion";
import Reveal from "@/components/Reveal";
import AffordableFaq, { type AffordableFaqItem } from "@/components/AffordableFaq";

const WINE = "#66202A";
const GOLD = "#E1B878";
const INK = "#192735";

const FAQS: AffordableFaqItem[] = [
  {
    q: "Types of Services provided",
    a:
      "Clinical Interns provide 2-free Counseling sessions to you, your child, or teen! Then, we offer “pay what you can” sessions. During your intake call with our admin you will discuss your fee rate between $20-$60 or the package rate. Under supervision, the Clinical Student Intern, will work with you and your family to determine your treatment needs and provide therapeutic techniques to help you reduce or manage your mental health concerns.",
  },
  {
    q: "How do I qualify for Free Therapy?",
    list: [
      "I do not have insurance.",
      "I can not afford full.",
      "My family does not have insurance and cannot afford to pay out-of-pocket for services.",
      "I am waiting on my insurance to be eligible for services.",
    ],
    a: "If you are interested or have further questions, please call our main office at 725-238-6990.",
  },
  {
    q: "How long are the therapy sessions?",
    a:
      "All sessions with a practicum student are 45-55 minutes in length, similar to standard therapy sessions. If you prefer longer sessions, we offer an extended option at a 10% increased rate. Please note that practicum students are still in training and completing their graduate education. As such, their availability is limited to their practicum period, which typically lasts 3-4 months. Once their practicum ends, therapy services with that student will conclude. If the student continues their training toward licensure at our practice, you may have the option to work with them in a different capacity, subject to availability and supervision requirements.",
  },
  {
    q: "Do you charged for missed sessions?",
    a:
      "We kindly remind you that a $50 fee will be charged for any missed sessions, including within the first two free sessions. It’s important to inform us if you're unable to attend your scheduled appointment, as our interns rely on these sessions to complete their required hours and provide quality care. If you need to cancel or reschedule, please contact our office directly at 725-238-6990 within 24 hours of your appointment. We appreciate your understanding and cooperation in helping us maintain a smooth and efficient practice for everyone.",
  },
];

const goldBtn =
  "inline-block font-display font-bold tracking-[0.15em] text-[13px] uppercase px-8 py-4 transition hover:opacity-90";

export default function AffordableContent() {
  return (
    <article className="bg-white">
      {/* HERO */}
      <section className="relative overflow-hidden">
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{
            backgroundImage:
              "linear-gradient(rgba(15,22,30,0.55), rgba(15,22,30,0.55)), url('/images/affordable/hero-bg.webp')",
          }}
          aria-hidden
        />
        <div className="relative container-x py-28 sm:py-36 lg:py-44 text-center">
          <Reveal>
            <h1
              className="font-display font-bold leading-tight text-[36px] sm:text-[48px] lg:text-[58px]"
              style={{ color: "#F4F4F4" }}
            >
              <span style={{ color: GOLD }}>Affordable Therapy</span> in Las Vegas, NV
            </h1>
          </Reveal>
        </div>
      </section>

      {/* SECTION 2 — LOW COST therapy + image */}
      <section className="bg-white">
        <div className="container-x py-20 lg:py-24">
          <div className="grid lg:grid-cols-12 gap-12 lg:gap-16 items-center">
            <Reveal className="lg:col-span-7">
              <h2
                className="font-display font-bold leading-[1.15] text-[32px] sm:text-[40px] lg:text-[45px]"
                style={{ color: INK }}
              >
                We offer <span style={{ color: WINE }}>LOW COST</span> therapy in Las Vegas, NV
              </h2>
              <p className="mt-6 text-[16px] leading-[1.8] text-ink-soft">
                Many people are often unable to obtain mental health services due to lack of
                insurance and high out of pocket cost.
              </p>
              <p className="mt-5 text-[16px] leading-[1.8] text-ink-soft">
                Then &ldquo;pay what you can program&rdquo; offering sessions between $25-$60
                each. Or Pay for a 5 session package for $150 or 10 sessions for $250.
                Packages last for 6 months
              </p>
              <p className="mt-5 text-[16px] leading-[1.8] text-ink-soft">
                At Brighter Tomorrow. it&rsquo;s important to us that everyone has access to
                affordable therapy services.
              </p>
              <p className="mt-5 text-[16px] leading-[1.8] text-ink-soft">
                Through our counseling internship student program, we are able to make this
                a reality and offer low cost for therapy sessions. These are full length, 50
                minute long sessions that will help get you or your loved one to a better
                mental state. We offer both in person sessions at our office in Las Vegas or
                virtually throughout all of Nevada.
              </p>
              <p className="mt-5 text-[16px] leading-[1.8] text-ink-soft">
                Learn more about our process and our Master&rsquo;s level students below,
                then click to schedule an intake and get started!
              </p>
              <p className="mt-5 text-[16px] leading-[1.8] text-ink-soft italic">
                Our Master&rsquo;s level students do not take insurance and can not provide
                reimbursement for insurance.
              </p>
              <div className="mt-8">
                <Link
                  href="/contact"
                  className={goldBtn}
                  style={{ backgroundColor: GOLD, color: INK, borderRadius: "30px 0 30px 30px" }}
                >
                  Book an Appointment
                </Link>
              </div>
            </Reveal>

            <Reveal delay={0.1} className="lg:col-span-5">
              <div className="relative mx-auto max-w-[460px]">
                <div
                  className="absolute -bottom-6 -right-6 w-full h-full"
                  style={{ backgroundColor: WINE, borderRadius: "60px 0 60px 60px" }}
                  aria-hidden
                />
                <motion.div
                  className="relative aspect-[4/5] overflow-hidden"
                  style={{ borderRadius: "60px 0 60px 60px" }}
                  whileHover={{ scale: 1.02 }}
                  transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                >
                  <Image
                    src="/images/affordable/session-1.jpg"
                    alt="Therapist meeting with client in a calm office"
                    fill
                    priority
                    sizes="(min-width:1024px) 460px, 100vw"
                    className="object-cover"
                  />
                </motion.div>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* SECTION 3 — FAQs (white bg, wine accents) */}
      <section className="bg-white py-20 lg:py-24">
        <div className="container-narrow">
          <Reveal>
            <p
              className="text-center font-script italic text-[20px] sm:text-[24px]"
              style={{ color: WINE }}
            >
              FAQs
            </p>
            <h3
              className="mt-2 text-center font-display font-bold text-[28px] sm:text-[34px] lg:text-[37.5px]"
              style={{ color: INK }}
            >
              Frequently asked questions
            </h3>
          </Reveal>

          <div className="mt-4">
            <AffordableFaq items={FAQS} />
          </div>

          <Reveal delay={0.15}>
            <div className="mt-10 flex justify-center">
              <Link
                href="/team"
                className={goldBtn}
                style={{
                  backgroundColor: WINE,
                  color: "#fff",
                  borderRadius: "30px 0 30px 30px",
                }}
              >
                Meet your student therapist
              </Link>
            </div>
          </Reveal>
        </div>
      </section>

      {/* SECTION 4 — Clinical Internship Program with photo */}
      <section className="bg-white">
        <div className="container-x py-20 lg:py-24">
          <div className="grid lg:grid-cols-12 gap-12 lg:gap-16 items-center">
            <Reveal className="lg:col-span-5 order-2 lg:order-1">
              <div className="relative mx-auto max-w-[460px]">
                <div
                  className="absolute -bottom-6 -left-6 w-full h-full"
                  style={{ backgroundColor: WINE, borderRadius: "60px 0 60px 60px" }}
                  aria-hidden
                />
                <motion.div
                  className="relative aspect-[4/5] overflow-hidden"
                  style={{ borderRadius: "60px 0 60px 60px" }}
                  whileHover={{ scale: 1.02 }}
                  transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                >
                  <Image
                    src="/images/affordable/session-2.jpg"
                    alt="Young person in a supportive therapy session"
                    fill
                    sizes="(min-width:1024px) 460px, 100vw"
                    className="object-cover"
                  />
                </motion.div>
              </div>
            </Reveal>

            <Reveal className="lg:col-span-7 order-1 lg:order-2">
              <p
                className="font-script italic text-[20px] sm:text-[24px]"
                style={{ color: WINE }}
              >
                Clinical Internship Program
              </p>
              <h2
                className="mt-2 font-display font-bold leading-[1.15] text-[32px] sm:text-[40px] lg:text-[45px]"
                style={{ color: INK }}
              >
                Our Clinical Internship Program
              </h2>
              <p className="mt-6 text-[16px] leading-[1.8] text-ink-soft">
                The Clinical Student Internship Program is for Graduate degree students who
                are in their practicum courses in their Master&rsquo;s degree program.
              </p>
              <p className="mt-5 text-[16px] leading-[1.8] text-ink-soft">
                The Clinical Student Internship offers Master-level students the opportunity
                to earn their practicum hours toward their degree and graduation.
              </p>
              <p className="mt-5 text-[16px] leading-[1.8] text-ink-soft">
                We accept Graduate Student Interns pursuing their Master&rsquo;s degree in
                Clinical Mental Health Counseling.
              </p>
            </Reveal>
          </div>
        </div>
      </section>

      {/* SECTION 5 — Ready to schedule for Free Therapy */}
      <section className="bg-cream-alt py-20 lg:py-24">
        <div className="container-narrow text-center">
          <Reveal>
            <h2
              className="font-display font-bold leading-[1.15] text-[32px] sm:text-[40px] lg:text-[45px]"
              style={{ color: INK }}
            >
              Ready to schedule for <span style={{ color: WINE }}>Free Therapy?</span>
            </h2>
            <div className="mt-8 grid sm:grid-cols-2 gap-8 text-left max-w-3xl mx-auto">
              <div>
                <p className="text-[16px] leading-[1.8] text-ink-soft">
                  Schedule your therapy intake session here!
                </p>
                <p className="mt-3 text-[16px] leading-[1.8] text-ink-soft">
                  We are ready to help support you or your family.
                </p>
                <div className="mt-6">
                  <Link
                    href="/contact"
                    className={goldBtn}
                    style={{
                      backgroundColor: GOLD,
                      color: INK,
                      borderRadius: "30px 0 30px 30px",
                    }}
                  >
                    Book an Appointment
                  </Link>
                </div>
              </div>
              <div>
                <p className="text-[15px] leading-[1.75] text-ink-soft">
                  After scheduling please check your email for a link to complete additional
                  forms. Please also check your spam folder. All forms must be completed{" "}
                  <span className="font-semibold text-ink">72 hours BEFORE</span> session to
                  allow time to review. If not complete session will be cancelled and
                  rescheduled.
                </p>
                <p className="mt-3 text-[15px] leading-[1.75] text-ink-soft">
                  We look forward to meeting you!
                </p>
                <p className="mt-3 text-[15px] leading-[1.75] italic" style={{ color: WINE }}>
                  ~ Therapy for Brighter Tomorrow Counseling.
                </p>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* SECTION 6 — Healing journey CTA banner (grey-blue overlay on background image) */}
      <section className="relative overflow-hidden">
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{
            backgroundImage:
              "linear-gradient(rgba(110,122,138,0.85), rgba(110,122,138,0.85)), url('/images/affordable/cta-bg.jpg')",
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
              Let us <span style={{ color: GOLD }}>help you</span> or your loved one heal.
              brighter tomorrow!
            </h3>
            <div className="mt-8">
              <Link
                href="/contact"
                className={goldBtn}
                style={{
                  backgroundColor: GOLD,
                  color: INK,
                  borderRadius: "30px 0 30px 30px",
                }}
              >
                Consultation Now
              </Link>
            </div>
          </Reveal>
        </div>
      </section>

      {/* SECTION 7 — Find your therapist */}
      <section className="bg-white py-16 lg:py-20">
        <div className="container-narrow text-center">
          <Reveal>
            <p
              className="font-script italic text-[18px] sm:text-[22px]"
              style={{ color: WINE }}
            >
              Find your therapist here
            </p>
            <div className="mt-6 flex justify-center">
              <Link
                href="/team"
                className={goldBtn}
                style={{ backgroundColor: GOLD, color: INK, borderRadius: "30px 0 30px 30px" }}
              >
                Click here
              </Link>
            </div>
          </Reveal>
        </div>
      </section>
    </article>
  );
}
