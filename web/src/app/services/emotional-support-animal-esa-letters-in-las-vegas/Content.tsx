"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { motion, AnimatePresence } from "framer-motion";
import Reveal from "@/components/Reveal";
import {
  FiCheckCircle,
  FiChevronRight,
  FiChevronDown,
} from "react-icons/fi";

const WINE = "#66202A";
const GOLD = "#E1B878";
const INK = "#192735";
const SAGE = "#6E7A8A";

const NEW_CLIENT_STEPS = [
  {
    title: "Step 1: Schedule an Intake Appointment",
    intro: "You will meet with a licensed therapist.",
    items: [
      "Complete consent forms",
      "You answer mental health questionnaires",
      "The therapist reviews your history and symptoms",
      "A diagnosis may be made if appropriate",
    ],
    note: "We do not provide ESA letters during quick phone calls.",
  },
  {
    title: "Step 2: Attend a Follow-Up Session",
    intro: "You must attend at least one additional therapy session.",
    items: [
      "Your therapist reviews your symptoms",
      "You discuss how your animal helps you",
      "The therapist decides if an ESA letter is medically necessary",
    ],
    note: "This ensures your ESA letter in Las Vegas is valid and supported.",
  },
];

const CURRENT_CLIENT_STEPS = [
  "Let your therapist know you are requesting an ESA letter",
  "Your therapist will review your diagnosis and treatment progress",
  "You may need one additional session to discuss medical necessity",
  "The therapist will determine if criteria are met",
];

const APPROVAL_CARDS = [
  {
    color: GOLD,
    text: (
      <>
        You will receive a secure message in your client portal. The $100 ESA
        administrative fee must be paid before the letter is released.
      </>
    ),
  },
  {
    color: WINE,
    text: (
      <>
        <p>
          After payment is received, your therapist will prepare your letter
          within 48–72 business hours (Monday through Friday, not including
          holidays).
        </p>
        <p className="mt-3">During this time we:</p>
        <ul className="mt-2 list-disc list-inside space-y-1">
          <li>Review your documentation</li>
          <li>Confirm everything meets housing guidelines</li>
          <li>Prepare the letter on official letterhead</li>
        </ul>
      </>
    ),
  },
  {
    color: GOLD,
    text: (
      <>
        Your ESA letter will be delivered through your secure client portal as
        a PDF.
        <br />
        We do not send ESA letters through regular email.
      </>
    ),
  },
];

const HOUSING_YES = [
  "Landlords must usually allow approved ESAs",
  "Pet deposits are often waived",
  "Breed and size restrictions may not apply",
];
const HOUSING_NO = [
  "Landlords can verify your documentation",
  "They may deny the request if the animal is dangerous or causes serious damage",
];

const CHOOSE_LIST = [
  "Licensed Nevada therapists",
  "Full mental health evaluations",
  "Secure and private documentation",
  "Ethical and careful decision-making",
];
const CITIES = ["Las Vegas", "Henderson", "Summerlin", "North Las Vegas", "Clark County"];

const FAQS = [
  {
    q: "How long does it take to get an ESA letter in Las Vegas?",
    a: "Most clients receive their ESA letter within 1–2 weeks of completing their intake and follow-up session. After approval and payment of the $100 administrative fee, the letter itself is prepared within 48–72 business hours.",
  },
  {
    q: "Are online ESA letters valid?",
    a: "A legitimate ESA letter must come from a licensed mental health professional in your state who has actually evaluated you. Instant or online-only letters without a real evaluation are not considered valid and may be rejected by landlords.",
  },
  {
    q: "Can I bring my ESA to casinos or public places?",
    a: "No. Emotional support animals do not have public access rights under the Americans with Disabilities Act. ESA letters are primarily for housing under the Fair Housing Act — not for public spaces like casinos, restaurants, or airlines.",
  },
];

export default function EsaLettersPage() {
  const [costTab, setCostTab] = useState<"therapy" | "fee">("therapy");
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  return (
    <article className="bg-white">
      {/* HERO */}
      <section className="relative overflow-hidden">
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{
            backgroundImage:
              "linear-gradient(rgba(15,22,30,0.55), rgba(15,22,30,0.55)), url('/images/services/esa-letters/hero.webp')",
          }}
          aria-hidden
        />
        <div className="relative container-x py-28 sm:py-36 lg:py-44 text-center">
          <Reveal>
            <h1
              className="font-display font-bold leading-tight text-[40px] sm:text-[52px] lg:text-[60px] break-words"
              style={{ color: "#F4F4F4" }}
            >
              <span style={{ color: GOLD }}>Emotional Support Animal (ESA) Letters</span>{" "}
              in Las Vegas, NV
            </h1>
          </Reveal>
        </div>
      </section>

      {/* SECTION 2 — Compassionate + dog image */}
      <section className="bg-white">
        <div className="container-x py-20 lg:py-28">
          <div className="grid lg:grid-cols-12 gap-12 lg:gap-16 items-center">
            <Reveal className="lg:col-span-7">
              <p
                className="font-script italic text-[18px] sm:text-[20px] mb-3"
                style={{ color: WINE }}
              >
                Creating a brighter tomorrow, today.
              </p>
              <h2
                className="font-display font-bold leading-[1.15] text-[32px] sm:text-[40px] lg:text-[45px]"
                style={{ color: INK }}
              >
                Compassionate, Ethical Evaluations for Individuals with Mental
                Health Needs
              </h2>
              <p className="mt-6 text-[15px] sm:text-[16px] leading-[1.75] text-ink-soft">
                If you are looking for a real and legitimate ESA letter in Las
                Vegas, Brighter Tomorrow Therapy is here to help. Our licensed
                Nevada therapists provide careful, ethical evaluations to
                determine whether an emotional support animal is right for you.
                We do not offer instant approvals or online-only letters — we
                follow proper mental health and federal housing guidelines so
                everything is done the right way.
              </p>
              <div className="mt-8">
                <Link
                  href="https://brightertomorrow.janeapp.com/" target="_blank" rel="noopener noreferrer"
                  className="inline-block font-display font-bold tracking-[0.15em] text-[13px] uppercase px-8 py-4 transition hover:opacity-90"
                  style={{ backgroundColor: GOLD, color: INK, borderRadius: "30px 0 30px 30px" }}
                >
                  Schedule My ESA Appointment
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
                    src="/images/services/esa-letters/cat.webp"
                    alt="Emotional support cat with owner"
                    fill
                    priority
                    sizes="(min-width:1024px) 420px, 100vw"
                    className="object-cover"
                  />
                </motion.div>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* SECTION 3 — What is an ESA Letter? + dog */}
      <section className="bg-white">
        <div className="container-x pb-20 lg:pb-28">
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
                    src="/images/services/esa-letters/dog.webp"
                    alt="Emotional support dog with owner"
                    fill
                    sizes="(min-width:1024px) 460px, 100vw"
                    className="object-cover"
                  />
                </motion.div>
              </div>
            </Reveal>
            <Reveal className="lg:col-span-7 order-1 lg:order-2">
              <h2
                className="font-display font-bold leading-[1.15] text-[32px] sm:text-[40px] lg:text-[45px]"
                style={{ color: INK }}
              >
                What is an ESA Letter?
              </h2>
              <p
                className="mt-6 font-display font-semibold text-[18px] sm:text-[20px] leading-[1.65]"
                style={{ color: WINE }}
              >
                An Emotional Support Animal letter is a document written by a
                licensed mental health professional that confirms an animal
                helps reduce symptoms of a mental health condition.
              </p>
              <p className="mt-5 text-[16px] leading-[1.8] text-ink-soft">
                It confirms that:
              </p>
              <ul className="mt-3 space-y-2 text-[15.5px] text-ink-soft">
                {[
                  "You have a mental health condition",
                  "Your symptoms affect your daily life",
                  "An animal helps reduce your symptoms",
                ].map((s) => (
                  <li key={s} className="flex items-start gap-2">
                    <FiChevronRight className="mt-1 shrink-0" size={16} style={{ color: WINE }} />
                    <span>{s}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-5 text-[16px] leading-[1.8] text-ink-soft">
                ESA letters are supported under the Fair Housing Act and are
                mainly used for housing.
              </p>
              <p className="mt-5 text-[16px] leading-[1.8] text-ink-soft">
                Emotional support animals are not the same as service animals —
                they do not have public access rights under the Americans with
                Disabilities Act.
              </p>
              <div className="mt-8">
                <Link
                  href="https://brightertomorrow.janeapp.com/" target="_blank" rel="noopener noreferrer"
                  className="inline-block font-display font-bold tracking-[0.15em] text-[13px] uppercase px-8 py-4 transition hover:opacity-90"
                  style={{ backgroundColor: GOLD, color: INK, borderRadius: "30px 0 30px 30px" }}
                >
                  Schedule My ESA Appointment
                </Link>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* SECTION 4 — How to Get an ESA Letter (wine band, 2 cards) */}
      <section style={{ backgroundColor: WINE }} className="py-20 lg:py-28">
        <div className="container-x">
          <Reveal>
            <h3 className="text-center font-display font-bold text-white text-[28px] sm:text-[34px] lg:text-[40px] leading-[1.15]">
              How to Get an ESA Letter in Las Vegas
            </h3>
          </Reveal>

          <div className="mt-12 grid lg:grid-cols-2 gap-7 lg:gap-9">
            {/* New Clients card */}
            <Reveal>
              <div
                className="h-full p-8 sm:p-10"
                style={{
                  border: `1px solid ${GOLD}`,
                  borderRadius: "30px 0 30px 30px",
                }}
              >
                <h4
                  className="font-display font-bold text-[22px] sm:text-[24px]"
                  style={{ color: GOLD }}
                >
                  For New Clients
                </h4>
                <p className="mt-3 text-white/85 text-[14.5px] leading-[1.65]">
                  If you are new to Brighter Tomorrow Therapy, here is what to
                  expect:
                </p>
                {NEW_CLIENT_STEPS.map((s) => (
                  <div key={s.title} className="mt-6">
                    <p className="font-display font-bold text-[15.5px]" style={{ color: GOLD }}>
                      {s.title}
                    </p>
                    <p className="mt-2 text-white/85 text-[14.5px] leading-[1.65]">{s.intro}</p>
                    <ul className="mt-3 space-y-2">
                      {s.items.map((it) => (
                        <li
                          key={it}
                          className="flex items-start gap-2 text-white/85 text-[14px] leading-[1.6]"
                        >
                          <FiChevronRight className="mt-1 shrink-0" size={14} style={{ color: GOLD }} />
                          <span>{it}</span>
                        </li>
                      ))}
                    </ul>
                    <p className="mt-3 text-white/85 text-[13.5px] italic">{s.note}</p>
                  </div>
                ))}
                <div className="mt-8">
                  <Link
                    href="https://brightertomorrow.janeapp.com/" target="_blank" rel="noopener noreferrer"
                    className="inline-block font-display font-bold tracking-[0.15em] text-[12px] uppercase px-6 py-3 transition hover:opacity-90"
                    style={{ backgroundColor: GOLD, color: INK, borderRadius: "30px 0 30px 30px" }}
                  >
                    Schedule My First Session
                  </Link>
                </div>
              </div>
            </Reveal>

            {/* Current Clients card */}
            <Reveal delay={0.1}>
              <div
                className="h-full p-8 sm:p-10"
                style={{
                  border: `1px solid ${GOLD}`,
                  borderRadius: "30px 0 30px 30px",
                }}
              >
                <h4
                  className="font-display font-bold text-[22px] sm:text-[24px]"
                  style={{ color: GOLD }}
                >
                  For Current Clients
                </h4>
                <p className="mt-3 text-white/85 text-[14.5px] leading-[1.65]">
                  If you are already receiving therapy with us, you do not need
                  to complete a new intake.
                </p>
                <p className="mt-5 font-display font-semibold text-white text-[15px]">Instead:</p>
                <ul className="mt-3 space-y-2.5">
                  {CURRENT_CLIENT_STEPS.map((s) => (
                    <li
                      key={s}
                      className="flex items-start gap-2 text-white/85 text-[14.5px] leading-[1.6]"
                    >
                      <FiCheckCircle className="mt-1 shrink-0" size={16} style={{ color: GOLD }} />
                      <span>{s}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-5 text-white/85 text-[14px] italic">
                  Even for current clients, approval is based on clinical
                  standards.
                </p>
                <div className="mt-8">
                  <Link
                    href="/contact"
                    className="inline-block font-display font-bold tracking-[0.15em] text-[12px] uppercase px-6 py-3 transition hover:opacity-90"
                    style={{ backgroundColor: GOLD, color: INK, borderRadius: "30px 0 30px 30px" }}
                  >
                    Message Your Therapist
                  </Link>
                </div>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* SECTION 5 — When will I receive my letter? (sage band, 3 cards) */}
      <section style={{ backgroundColor: SAGE }} className="py-20 lg:py-24">
        <div className="container-x">
          <Reveal>
            <p className="text-center text-white text-[15.5px] sm:text-[16px] max-w-[680px] mx-auto leading-[1.6]">
              If your ESA request is approved, here is what happens next:
            </p>
          </Reveal>
          <div className="mt-10 grid md:grid-cols-3 gap-6 lg:gap-7">
            {APPROVAL_CARDS.map((c, i) => (
              <Reveal key={i} delay={i * 0.08}>
                <div
                  className="h-full p-7 sm:p-8 text-[14.5px] leading-[1.65]"
                  style={{
                    backgroundColor: c.color,
                    color: c.color === GOLD ? INK : "#FFFFFF",
                    borderRadius: "30px 0 30px 30px",
                  }}
                >
                  {c.text}
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* SECTION 6 — ESA Letter cost tabs */}
      <section className="bg-cream-alt py-20 lg:py-24">
        <div className="container-x max-w-[900px]">
          <Reveal>
            <h3
              className="text-center font-display font-bold text-[28px] sm:text-[34px] lg:text-[37.5px]"
              style={{ color: INK }}
            >
              ESA Letter Cost in Las Vegas
            </h3>
          </Reveal>

          <Reveal delay={0.05}>
            <div className="mt-10 bg-white p-2 rounded-[20px] flex flex-col sm:flex-row gap-2 max-w-[640px] mx-auto">
              {(["therapy", "fee"] as const).map((k) => {
                const active = costTab === k;
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setCostTab(k)}
                    className="flex-1 px-5 py-3 font-display font-bold text-[13.5px] sm:text-[15px] transition rounded-[16px]"
                    style={{
                      backgroundColor: active ? WINE : "transparent",
                      color: active ? GOLD : WINE,
                      border: active ? "none" : `1px solid ${WINE}`,
                    }}
                  >
                    {k === "therapy" ? "Therapy Sessions" : "ESA Letter Administrative Fee"}
                  </button>
                );
              })}
            </div>
          </Reveal>

          <Reveal delay={0.1}>
            <div
              className="mt-6 p-8 sm:p-10 text-white"
              style={{ backgroundColor: WINE, borderRadius: "30px 0 30px 30px" }}
            >
              {costTab === "therapy" ? (
                <div className="space-y-4 text-[15px] leading-[1.7]">
                  <p>If you use insurance:</p>
                  <ul className="list-disc list-inside space-y-1.5 text-white/90">
                    <li>Therapy sessions are billed to insurance</li>
                    <li>You are responsible for your copay or deductible</li>
                  </ul>
                  <p className="pt-3">If you pay out-of-pocket:</p>
                  <ul className="list-disc list-inside space-y-1.5 text-white/90">
                    <li>Standard therapy rates apply</li>
                  </ul>
                </div>
              ) : (
                <div className="space-y-4 text-[15px] leading-[1.7]">
                  <p className="font-display font-bold text-[20px]" style={{ color: GOLD }}>
                    $100
                  </p>
                  <p>This fee:</p>
                  <ul className="list-disc list-inside space-y-1.5 text-white/90">
                    <li>Is not covered by insurance</li>
                    <li>Covers review and letter preparation</li>
                    <li>Is only charged if the letter is approved</li>
                  </ul>
                  <p className="text-white/85 text-[14px] italic">
                    If your therapist decides an ESA letter is not appropriate,
                    you are not charged the administrative fee.
                  </p>
                </div>
              )}
            </div>
          </Reveal>

          <Reveal delay={0.15}>
            <div className="mt-8 text-center">
              <Link
                href="https://brightertomorrow.janeapp.com/" target="_blank" rel="noopener noreferrer"
                className="inline-block font-display font-bold tracking-[0.15em] text-[13px] uppercase px-8 py-4 transition hover:opacity-90"
                style={{ backgroundColor: GOLD, color: INK, borderRadius: "30px 0 30px 30px" }}
              >
                Schedule My ESA Appointment
              </Link>
            </div>
          </Reveal>
        </div>
      </section>

      {/* SECTION 7 — Housing Rights */}
      <section className="bg-white py-20 lg:py-24">
        <div className="container-x grid lg:grid-cols-12 gap-12 lg:gap-16 items-center">
          <Reveal className="lg:col-span-5">
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
                  src="/images/services/esa-letters/housing.webp"
                  alt="Owner holding emotional support dog outdoors"
                  fill
                  sizes="(min-width:1024px) 460px, 100vw"
                  className="object-cover"
                />
              </motion.div>
            </div>
          </Reveal>

          <Reveal className="lg:col-span-7" delay={0.08}>
            <h3
              className="font-display font-bold text-[28px] sm:text-[34px] lg:text-[40px] leading-[1.15]"
              style={{ color: INK }}
            >
              Housing Rights for ESA Letters in Nevada
            </h3>
            <p className="mt-5 font-display font-semibold text-[16.5px]" style={{ color: WINE }}>
              Under the Fair Housing Act:
            </p>
            <ul className="mt-3 space-y-2">
              {HOUSING_YES.map((it) => (
                <li
                  key={it}
                  className="flex items-start gap-2 text-[15px] text-ink-soft leading-[1.6]"
                >
                  <FiCheckCircle className="mt-1 shrink-0" size={16} style={{ color: WINE }} />
                  <span>{it}</span>
                </li>
              ))}
            </ul>
            <p className="mt-6 font-display font-semibold text-[16.5px]" style={{ color: WINE }}>
              However:
            </p>
            <ul className="mt-3 space-y-2">
              {HOUSING_NO.map((it) => (
                <li
                  key={it}
                  className="flex items-start gap-2 text-[15px] text-ink-soft leading-[1.6]"
                >
                  <FiChevronRight className="mt-1 shrink-0" size={16} style={{ color: WINE }} />
                  <span>{it}</span>
                </li>
              ))}
            </ul>
            <p className="mt-6 text-[15px] text-ink-soft italic">
              ESA letters are for housing only.
            </p>
            <div className="mt-8">
              <Link
                href="https://brightertomorrow.janeapp.com/" target="_blank" rel="noopener noreferrer"
                className="inline-block font-display font-bold tracking-[0.15em] text-[13px] uppercase px-8 py-4 transition hover:opacity-90"
                style={{ backgroundColor: GOLD, color: INK, borderRadius: "30px 0 30px 30px" }}
              >
                Schedule My ESA Appointment
              </Link>
            </div>
          </Reveal>
        </div>
      </section>

      {/* SECTION 8 — Why Choose + Cities */}
      <section className="bg-cream-alt py-20 lg:py-24">
        <div className="container-x">
          <Reveal>
            <h3
              className="text-center font-display font-bold text-[28px] sm:text-[34px] lg:text-[37.5px]"
              style={{ color: INK }}
            >
              Why Choose Brighter Tomorrow Therapy?
            </h3>
          </Reveal>
          <div className="mt-12 grid md:grid-cols-2 gap-12 lg:gap-16 max-w-[1000px] mx-auto">
            <Reveal>
              <p
                className="font-display font-semibold text-[16px] sm:text-[17px]"
                style={{ color: INK }}
              >
                If you need an{" "}
                <span style={{ color: WINE }}>ESA letter in Las Vegas</span>, we provide:
              </p>
              <ul className="mt-6 space-y-3">
                {CHOOSE_LIST.map((it) => (
                  <li
                    key={it}
                    className="flex items-start gap-3 text-[15px] text-ink-soft leading-[1.6]"
                  >
                    <FiChevronRight className="mt-1 shrink-0" size={18} style={{ color: GOLD }} />
                    <span>{it}</span>
                  </li>
                ))}
              </ul>
            </Reveal>
            <Reveal delay={0.08}>
              <p
                className="font-display font-semibold text-[16px] sm:text-[17px]"
                style={{ color: INK }}
              >
                We serve clients throughout the Las Vegas area:
              </p>
              <ul className="mt-6 space-y-3">
                {CITIES.map((it) => (
                  <li
                    key={it}
                    className="flex items-start gap-3 text-[15px] text-ink-soft leading-[1.6]"
                  >
                    <FiChevronRight className="mt-1 shrink-0" size={18} style={{ color: GOLD }} />
                    <span>{it}</span>
                  </li>
                ))}
              </ul>
            </Reveal>
          </div>
          <Reveal delay={0.18}>
            <p
              className="mt-12 text-center font-display font-semibold text-[16px]"
              style={{ color: INK }}
            >
              We offer both in-person and secure telehealth appointments in Nevada.
            </p>
          </Reveal>
        </div>
      </section>

      {/* SECTION 9 — FAQ */}
      <section className="bg-white py-20 lg:py-24">
        <div className="container-x max-w-[860px]">
          <Reveal>
            <h3
              className="text-center font-display font-bold text-[28px] sm:text-[34px] lg:text-[37.5px]"
              style={{ color: INK }}
            >
              Frequently Asked Questions
            </h3>
          </Reveal>
          <div className="mt-12 space-y-4">
            {FAQS.map((f, i) => {
              const open = openFaq === i;
              return (
                <Reveal key={f.q} delay={i * 0.05}>
                  <div
                    style={{
                      backgroundColor: WINE,
                      borderRadius: "30px 0 30px 30px",
                    }}
                    className="overflow-hidden"
                  >
                    <button
                      type="button"
                      onClick={() => setOpenFaq(open ? null : i)}
                      aria-expanded={open}
                      className="w-full flex items-center justify-between gap-4 px-6 sm:px-8 py-5 text-left"
                    >
                      <span className="font-display font-bold text-white text-[15.5px] sm:text-[17px] leading-[1.35]">
                        {f.q}
                      </span>
                      <motion.span
                        animate={{ rotate: open ? 180 : 0 }}
                        transition={{ duration: 0.3 }}
                        className="shrink-0"
                        style={{ color: GOLD }}
                      >
                        <FiChevronDown size={22} />
                      </motion.span>
                    </button>
                    <AnimatePresence initial={false}>
                      {open && (
                        <motion.div
                          key="content"
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                          className="overflow-hidden"
                        >
                          <div className="px-6 sm:px-8 pb-6 text-white/90 text-[14.5px] leading-[1.7]">
                            {f.a}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </Reveal>
              );
            })}
          </div>
        </div>
      </section>

      {/* SECTION 10 — CTA banner */}
      <section className="relative overflow-hidden" style={{ backgroundColor: SAGE }}>
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{
            backgroundImage:
              "linear-gradient(rgba(15,22,30,0.62), rgba(15,22,30,0.62)), url('/images/services/cta-bg.webp')",
          }}
          aria-hidden
        />
        <div className="container-x py-20 lg:py-24 text-center relative z-10">
          <Reveal>
            <p
              className="font-script italic text-[20px] sm:text-[24px]"
              style={{ color: GOLD }}
            >
              Ready to get your ESA Evaluation?
            </p>
            <h3 className="mt-3 font-display font-bold text-[32px] sm:text-[40px] lg:text-[45px] text-white leading-[1.15]">
              Schedule Your <span style={{ color: GOLD }}>ESA Evaluation</span> in Las Vegas!
            </h3>
            <p className="mt-5 max-w-[720px] mx-auto text-white/90 text-[15px] sm:text-[16px] leading-[1.7]">
              If you are looking for a trusted and licensed provider for an ESA
              letter in Las Vegas, schedule your appointment today. At Brighter
              Tomorrow Therapy, we handle documentation with care, clarity, and
              professionalism.
            </p>
            <div className="mt-8">
              <Link
                href="/contact"
                className="inline-block font-display font-bold tracking-[0.15em] text-[13px] uppercase px-8 py-4 transition hover:opacity-90"
                style={{ backgroundColor: GOLD, color: INK, borderRadius: "30px 0 30px 30px" }}
              >
                Get Started With My ESA Evaluation
              </Link>
            </div>
          </Reveal>
        </div>
      </section>
    </article>
  );
}
