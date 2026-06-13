"use client";

import Link from "next/link";
import Image from "next/image";
import { motion } from "framer-motion";
import Reveal from "@/components/Reveal";
import {
  FiCheckCircle,
  FiUser,
  FiTarget,
  FiTrendingUp,
  FiLock,
} from "react-icons/fi";

const WINE = "#66202A";
const GOLD = "#E1B878";
const INK = "#192735";

const BENEFITS = [
  {
    Icon: FiUser,
    title: "Personal Exploration",
    body: "Facilitating deep introspection and self-understanding to help you better know yourself.",
  },
  {
    Icon: FiTarget,
    title: "Targeted Healing",
    body: "Focused attention for trauma, anxiety, relationship issues, or other personal challenges.",
  },
  {
    Icon: FiTrendingUp,
    title: "Skill Enhancement",
    body: "Develop decision-making, emotional regulation, and assertiveness skills you can use in everyday life.",
  },
  {
    Icon: FiLock,
    title: "Confidential Sharing",
    body: "A safe, confidential space for vulnerability — share without fear of judgment.",
  },
];

const APPROACH = [
  {
    title: "Tailored Techniques",
    body: "Each session is crafted around the client's unique needs, goals, and pace.",
  },
  {
    title: "Deep Dive",
    body: "Addressing root causes of challenges, not just the surface symptoms.",
  },
  {
    title: "Continuous Feedback",
    body: "A collaborative approach that evolves in sync with the client's growth and changing goals.",
  },
  {
    title: "Expert Guidance",
    body: "Therapists bring a wealth of experience and proven, evidence-based methodologies to each session.",
  },
  {
    title: "Holistic Healing",
    body: "Beyond discussions, we integrate mindfulness, relaxation techniques, and cognitive exercises to offer a comprehensive healing experience.",
  },
];

export default function IndividualTherapyPage() {
  return (
    <article className="bg-white">
      {/* HERO */}
      <section className="relative overflow-hidden">
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{
            backgroundImage:
              "linear-gradient(rgba(15,22,30,0.55), rgba(15,22,30,0.55)), url('/images/services/individual-therapy/banner.webp')",
          }}
          aria-hidden
        />
        <div className="relative container-x py-28 sm:py-36 lg:py-44 text-center">
          <Reveal>
            <h1
              className="font-display font-bold leading-tight text-[40px] sm:text-[52px] lg:text-[60px] break-words"
              style={{ color: "#F4F4F4" }}
            >
              <span style={{ color: GOLD }}>Individual Therapy</span> in Las Vegas, NV
            </h1>
          </Reveal>
        </div>
      </section>

      {/* SECTION 2 — Holistic approach */}
      <section className="bg-white">
        <div className="container-x py-20 lg:py-28">
          <div className="grid lg:grid-cols-12 gap-12 lg:gap-16 items-center">
            <Reveal className="lg:col-span-7">
              <h2
                className="font-display font-bold leading-[1.15] text-[32px] sm:text-[40px] lg:text-[45px]"
                style={{ color: INK }}
              >
                Find clarity, healing, and personal growth in a safe space.
              </h2>
              <p className="mt-6 text-[15px] sm:text-[16px] leading-[1.75] text-ink-soft">
                At Brighter Tomorrow, individual therapy is a deeply personalized
                approach where each session resonates with the individual,
                fostering profound personal growth and healing. Creating a
                brighter tomorrow, today.
              </p>
              <div className="mt-8">
                <Link
                  href="https://brightertomorrow.janeapp.com/" target="_blank" rel="noopener noreferrer"
                  className="inline-block font-display font-bold tracking-[0.15em] text-[13px] uppercase px-8 py-4 transition hover:opacity-90"
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
                    src="/images/services/individual-therapy/hero.webp"
                    alt="Individual therapy session at Brighter Tomorrow"
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

      {/* SECTION 3 — What is Individual Therapy */}
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
                    src="/images/services/individual-therapy/session.webp"
                    alt="Therapist and client in a private session"
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
                What is Individual Therapy?
              </h2>
              <p
                className="mt-6 font-display font-semibold text-[18px] sm:text-[20px] leading-[1.65]"
                style={{ color: WINE }}
              >
                Individual therapy is a personalized form of psychotherapy where
                clients work directly with a trained therapist in a one-on-one
                setting.
              </p>
              <p className="mt-5 text-[16px] leading-[1.8] text-ink-soft">
                Unlike group therapy, individual therapy offers a private setting
                for clients to delve deep into their personal challenges,
                aspirations, and emotions. Sessions move at your pace and adapt
                to what you need most in the moment.
              </p>
              <p className="mt-5 text-[16px] leading-[1.8] text-ink-soft">
                Whether you&rsquo;re navigating a specific issue or simply
                looking to better understand yourself, individual therapy
                provides the structure and support to help you move forward with
                clarity and confidence.
              </p>
              <div className="mt-8">
                <Link
                  href="https://brightertomorrow.janeapp.com/" target="_blank" rel="noopener noreferrer"
                  className="inline-block font-display font-bold tracking-[0.15em] text-[13px] uppercase px-8 py-4 transition hover:opacity-90"
                  style={{ backgroundColor: GOLD, color: INK, borderRadius: "30px 0 30px 30px" }}
                >
                  Book an Appointment
                </Link>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* SECTION 4 — Benefits */}
      <section style={{ backgroundColor: WINE }} className="relative">
        <div className="bg-cream pt-16 pb-20 px-4 sm:px-6 lg:px-10 mx-3 sm:mx-6 lg:mx-12 rounded-[40px] -my-10 relative z-10">
          <Reveal>
            <h3
              className="text-center font-display font-bold text-[28px] sm:text-[34px] lg:text-[37.5px]"
              style={{ color: INK }}
            >
              Benefits of Individual Therapy
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
                  <span className="inline-grid place-items-center w-14 h-14 mx-auto" style={{ color: WINE }}>
                    <Icon size={36} strokeWidth={1.5} />
                  </span>
                  <h4 className="mt-3 font-display font-bold text-[18px] sm:text-[20px] leading-[1.3]" style={{ color: INK }}>
                    {title}
                  </h4>
                  <p className="mt-3 text-[14.5px] leading-[1.65] text-ink-soft">{body}</p>
                </motion.div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* SECTION 5 — Our Approach */}
      <section style={{ backgroundColor: WINE }} className="pt-28 pb-20">
        <div className="container-x">
          <div className="grid lg:grid-cols-12 gap-10 lg:gap-12">
            <Reveal className="lg:col-span-4">
              <h3 className="font-display font-bold text-[28px] sm:text-[34px] lg:text-[37.5px] text-white leading-[1.2]">
                Our Approach to Individual Therapy
              </h3>
              <p className="mt-5 text-white/85 leading-[1.7] text-[15px]">
                Every person&rsquo;s story is different. Our therapists meet you
                where you are and design a plan that fits your life.
              </p>
            </Reveal>
            <div className="lg:col-span-8 grid sm:grid-cols-2 gap-x-10 gap-y-8">
              {APPROACH.map((it, i) => (
                <Reveal key={it.title} delay={i * 0.07}>
                  <div className="flex items-start gap-4">
                    <span className="mt-0.5 inline-grid place-items-center w-9 h-9 shrink-0 rounded-full" style={{ border: `2px solid ${GOLD}`, color: GOLD }}>
                      <FiCheckCircle size={20} strokeWidth={2} />
                    </span>
                    <div>
                      <h4 className="font-display font-bold text-[18px] sm:text-[20px] text-white leading-[1.25]">{it.title}</h4>
                      <p className="mt-2 text-white/85 text-[14.5px] leading-[1.65]">{it.body}</p>
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
                style={{ backgroundColor: GOLD, color: INK, borderRadius: "30px 0 30px 30px" }}
              >
                Book an Appointment
              </Link>
            </div>
          </Reveal>
        </div>
      </section>

      {/* SECTION 6 — Begin Your Healing Journey Today */}
      <section className="bg-cream-alt py-20 lg:py-28">
        <div className="container-x max-w-3xl text-center">
          <Reveal>
            <h3 className="font-display font-bold text-[28px] sm:text-[34px] lg:text-[37.5px] leading-[1.2]" style={{ color: INK }}>
              Begin Your Healing Journey Today
            </h3>
            <p className="mt-6 text-[15px] sm:text-[16px] leading-[1.75] text-ink-soft">
              Embark on a journey tailored to you. At Brighter Tomorrow, our
              individual therapy sessions are designed to resonate deeply,
              offering insights, healing, and personal growth. Take the step
              towards a brighter, more fulfilled self.
            </p>
            <div className="mt-8">
              <Link
                href="https://brightertomorrow.janeapp.com/" target="_blank" rel="noopener noreferrer"
                className="inline-block font-display font-bold tracking-[0.15em] text-[13px] uppercase px-8 py-4 transition hover:opacity-90"
                style={{ backgroundColor: GOLD, color: INK, borderRadius: "30px 0 30px 30px" }}
              >
                Book an Appointment
              </Link>
            </div>
          </Reveal>
        </div>
      </section>

      {/* SECTION 7 — CTA */}
      <section className="relative overflow-hidden" style={{ backgroundColor: "#6E7A8A" }}>
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
            <p className="font-script italic text-[20px] sm:text-[24px]" style={{ color: GOLD }}>
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
