"use client";

import Link from "next/link";
import Image from "next/image";
import { motion } from "framer-motion";
import Reveal from "@/components/Reveal";
import {
  FiCheckCircle,
  FiChevronRight,
  FiTrendingUp,
  FiEye,
  FiShield,
  FiHeart,
} from "react-icons/fi";

const WINE = "#66202A";
const GOLD = "#E1B878";
const INK = "#192735";

const BENEFITS = [
  {
    Icon: FiTrendingUp,
    title: "Improved Coping Skills",
    body: "Learn effective strategies to manage and reduce anxiety symptoms.",
  },
  {
    Icon: FiEye,
    title: "Enhanced Understanding",
    body: "Gain insights into the triggers and patterns of your anxiety.",
  },
  {
    Icon: FiShield,
    title: "Provide a Safe Space",
    body: "Our clinic offers a calm, confidential environment where you can openly discuss your feelings and concerns.",
  },
  {
    Icon: FiHeart,
    title: "Holistic Healing",
    body: "Beyond addressing symptoms, we aim to equip you with tools and strategies to foster overall well-being and resilience.",
  },
];

const APPROACH = [
  {
    title: "Offer Personalized Care",
    body: "Recognizing that anxiety manifests differently in everyone, our therapy sessions are tailored to address each individual's unique challenges.",
  },
  {
    title: "Utilize Evidence-Based Techniques",
    body: "Our therapists are trained in the latest evidence-based techniques, ensuring you receive the most effective treatment.",
  },
  {
    title: "Provide a Safe Space",
    body: "Our clinic offers a calm, confidential environment where you can openly discuss your feelings and concerns.",
  },
  {
    title: "Focus on Holistic Healing",
    body: "Beyond addressing symptoms, we aim to equip you with tools and strategies to foster overall well-being and resilience.",
  },
];

const CONSIDER = [
  "Experience frequent, intense, and persistent worry about everyday situations.",
  "Find it hard to control your feelings of worry or find that they interfere with daily activities.",
  "Exhibit physical symptoms like rapid heartbeat, sweating, trembling, or fatigue linked to anxiety.",
  "Avoid situations or places because they trigger anxiety or feel overwhelming.",
  "Desire tools and strategies to cope with stressful situations or events.",
];

export default function AnxietyTherapyPage() {
  return (
    <article className="bg-white">
      {/* HERO */}
      <section className="relative overflow-hidden">
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{
            backgroundImage:
              "linear-gradient(rgba(15,22,30,0.55), rgba(15,22,30,0.55)), url('/images/specialties/anxiety-therapy/hero.webp')",
          }}
          aria-hidden
        />
        <div className="relative container-x py-28 sm:py-36 lg:py-44 text-center">
          <Reveal>
            <h1
              className="font-display font-bold leading-tight text-[40px] sm:text-[52px] lg:text-[60px]"
              style={{ color: "#F4F4F4" }}
            >
              <span style={{ color: GOLD }}>Anxiety Therapy</span> in Las Vegas,
              NV
            </h1>
          </Reveal>
        </div>
      </section>

      {/* SECTION 2 — Intro */}
      <section className="bg-white">
        <div className="container-x py-20 lg:py-28">
          <div className="grid lg:grid-cols-12 gap-12 lg:gap-16 items-center">
            <Reveal className="lg:col-span-7">
              <h2
                className="font-display font-bold leading-[1.15] text-[32px] sm:text-[40px] lg:text-[45px]"
                style={{ color: INK }}
              >
                In today&rsquo;s fast-paced world, anxiety has become a common
                challenge.
              </h2>
              <p className="mt-6 text-[15px] sm:text-[16px] leading-[1.75] text-ink-soft">
                At Brighter Tomorrow, we understand the complexities of anxiety
                and offer specialized therapeutic interventions to help
                individuals regain peace, balance, and control in their lives.
              </p>
              <div className="mt-8">
                <Link
                  href="https://brightertomorrow.janeapp.com/" target="_blank" rel="noopener noreferrer"
                  className="inline-block font-display font-bold tracking-[0.15em] text-[13px] uppercase px-8 py-4 transition hover:opacity-90"
                  style={{
                    backgroundColor: GOLD,
                    color: INK,
                    borderRadius: "30px 0 30px 30px",
                  }}
                >
                  Book an Appointment
                </Link>
              </div>
            </Reveal>

            <Reveal delay={0.1} className="lg:col-span-5">
              <div className="relative mx-auto max-w-[460px]">
                <div
                  className="absolute -bottom-6 -right-6 w-full h-full"
                  style={{
                    backgroundColor: WINE,
                    borderRadius: "60px 0 60px 60px",
                  }}
                  aria-hidden
                />
                <motion.div
                  className="relative aspect-[4/5] overflow-hidden"
                  style={{ borderRadius: "60px 0 60px 60px" }}
                  whileHover={{ scale: 1.02 }}
                  transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                >
                  <Image
                    src="/images/specialties/anxiety-therapy/img-1.webp"
                    alt="Person experiencing anxiety, hands on head"
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

      {/* SECTION 3 — Definition */}
      <section className="bg-white">
        <div className="container-x pb-20 lg:pb-28">
          <div className="grid lg:grid-cols-12 gap-12 lg:gap-16 items-center">
            <Reveal className="lg:col-span-5 order-2 lg:order-1"
            >
              <div className="relative mx-auto max-w-[460px]">
                <div
                  className="absolute -bottom-6 -left-6 w-full h-full"
                  style={{
                    backgroundColor: WINE,
                    borderRadius: "60px 0 60px 60px",
                  }}
                  aria-hidden
                />
                <motion.div
                  className="relative aspect-[4/5] overflow-hidden"
                  style={{ borderRadius: "60px 0 60px 60px" }}
                  whileHover={{ scale: 1.02 }}
                  transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                >
                  <Image
                    src="/images/specialties/anxiety-therapy/img-2.webp"
                    alt="Person seated, reflecting in a quiet moment"
                    fill
                    sizes="(min-width:1024px) 460px, 100vw"
                    className="object-cover"
                  />
                </motion.div>
              </div>
            </Reveal>

            <Reveal className="lg:col-span-7 order-1 lg:order-2"
            >
              <p
                className="font-display font-semibold text-[18px] sm:text-[20px] leading-[1.65]"
                style={{ color: WINE }}
              >
                Anxiety therapy is a targeted approach to address and manage the
                symptoms and root causes of anxiety disorders.
              </p>
              <p className="mt-5 text-[16px] leading-[1.8] text-ink-soft">
                It encompasses various therapeutic techniques, from
                cognitive-behavioral therapy (CBT) to mindfulness practices,
                designed to help individuals understand their anxiety, develop
                coping mechanisms, and reduce the intensity and frequency of
                anxiety symptoms.
              </p>
              <div className="mt-8">
                <Link
                  href="https://brightertomorrow.janeapp.com/" target="_blank" rel="noopener noreferrer"
                  className="inline-block font-display font-bold tracking-[0.15em] text-[13px] uppercase px-8 py-4 transition hover:opacity-90"
                  style={{
                    backgroundColor: GOLD,
                    color: INK,
                    borderRadius: "30px 0 30px 30px",
                  }}
                >
                  Book an Appointment
                </Link>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* SECTION 4 — Benefits (cream card on wine band) */}
      <section style={{ backgroundColor: WINE }} className="relative">
        <div className="bg-cream pt-16 pb-20 px-4 sm:px-6 lg:px-10 mx-3 sm:mx-6 lg:mx-12 rounded-[40px] -my-10 relative z-10">
          <Reveal>
            <h3
              className="text-center font-display font-bold text-[28px] sm:text-[34px] lg:text-[37.5px]"
              style={{ color: INK }}
            >
              Benefits of Anxiety Therapy
            </h3>
          </Reveal>

          <div className="mt-12 grid sm:grid-cols-2 lg:grid-cols-4 gap-6 lg:gap-7">
            {BENEFITS.map(({ Icon, title, body }, i) => (
              <Reveal key={title} delay={i * 0.08}>
                <motion.div
                  whileHover={{ y: -6 }}
                  transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                  className="h-full bg-white p-7 text-center"
                  style={{
                    borderRadius: "30px 0 30px 30px",
                    border: `1px solid ${i === 0 ? WINE : GOLD}`,
                  }}
                >
                  <span
                    className="inline-grid place-items-center w-14 h-14 mx-auto"
                    style={{ color: WINE }}
                  >
                    <Icon size={36} strokeWidth={1.5} />
                  </span>
                  <h4
                    className="mt-3 font-display font-bold text-[18px] sm:text-[20px] leading-[1.3]"
                    style={{ color: INK }}
                  >
                    {title}
                  </h4>
                  <p className="mt-3 text-[14.5px] leading-[1.65] text-ink-soft">
                    {body}
                  </p>
                </motion.div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* SECTION 5 — Our Approach to Anxiety Therapy (wine bg, white text) */}
      <section style={{ backgroundColor: WINE }} className="pt-28 pb-20">
        <div className="container-x">
          <div className="grid lg:grid-cols-12 gap-10 lg:gap-12">
            <Reveal className="lg:col-span-4">
              <h3 className="font-display font-bold text-[28px] sm:text-[34px] lg:text-[37.5px] text-white leading-[1.2]">
                Our Approach to Anxiety Therapy
              </h3>
              <p className="mt-5 text-white/85 leading-[1.7] text-[15px]">
                At Brighter Tomorrow Counseling Center, we:
              </p>
            </Reveal>

            <div className="lg:col-span-8 grid sm:grid-cols-2 gap-x-10 gap-y-8">
              {APPROACH.map((it, i) => (
                <Reveal key={it.title} delay={i * 0.07}>
                  <div className="flex items-start gap-4">
                    <span
                      className="mt-0.5 inline-grid place-items-center w-9 h-9 shrink-0 rounded-full"
                      style={{ border: `2px solid ${GOLD}`, color: GOLD }}
                    >
                      <FiCheckCircle size={20} strokeWidth={2} />
                    </span>
                    <div>
                      <h4 className="font-display font-bold text-[18px] sm:text-[20px] text-white leading-[1.25]">
                        {it.title}
                      </h4>
                      <p className="mt-2 text-white/85 text-[14.5px] leading-[1.65]">
                        {it.body}
                      </p>
                    </div>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>

          <Reveal delay={0.2}>
            <div className="mt-10 flex justify-end">
              <Link
                href="https://brightertomorrow.janeapp.com/" target="_blank" rel="noopener noreferrer"
                className="inline-block font-display font-bold tracking-[0.15em] text-[13px] uppercase px-8 py-4 transition hover:opacity-90"
                style={{
                  backgroundColor: GOLD,
                  color: INK,
                  borderRadius: "30px 0 30px 30px",
                }}
              >
                Book an Appointment
              </Link>
            </div>
          </Reveal>
        </div>
      </section>

      {/* SECTION 6 — Who is Anxiety Therapy for? (cream-alt bg, centered) */}
      <section className="bg-cream-alt py-20 lg:py-24">
        <div className="container-x">
          <Reveal>
            <h3
              className="text-center font-display font-bold text-[28px] sm:text-[34px] lg:text-[37.5px]"
              style={{ color: INK }}
            >
              Who is Anxiety Therapy for?
            </h3>
            <p
              className="mt-6 text-center mx-auto max-w-3xl text-[15px] sm:text-[16px] leading-[1.75] text-ink-soft"
            >
              You might consider anxiety therapy if you:
            </p>
          </Reveal>
          <ul className="mt-8 space-y-4 max-w-3xl mx-auto">
            {CONSIDER.map((item, i) => (
              <motion.li
                key={item}
                initial={{ opacity: 0, x: -16 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true, amount: 0.4 }}
                transition={{ duration: 0.5, delay: i * 0.06 }}
                className="flex items-start gap-3 text-[15px] text-ink-soft leading-[1.7]"
              >
                <FiChevronRight
                  className="mt-1 shrink-0"
                  size={18}
                  style={{ color: WINE }}
                />
                <span>{item}</span>
              </motion.li>
            ))}
          </ul>
        </div>
      </section>

      {/* SECTION 7 — CTA banner */}
      <section
        className="relative overflow-hidden"
        style={{ backgroundColor: "#6E7A8A" }}
      >
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{
            backgroundImage:
              "linear-gradient(rgba(110,122,138,0.82), rgba(110,122,138,0.82)), url('/images/specialties/anxiety-therapy/cta-bg.webp')",
          }}
          aria-hidden
        />
        <div className="container-x py-20 lg:py-24 text-center relative z-10">
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
                className="inline-block font-display font-bold tracking-[0.15em] text-[13px] uppercase px-8 py-4 transition hover:opacity-90"
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
    </article>
  );
}
