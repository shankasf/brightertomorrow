"use client";

import Link from "next/link";
import Image from "next/image";
import { motion } from "framer-motion";
import Reveal from "@/components/Reveal";
import { FiCheckCircle, FiChevronRight } from "react-icons/fi";

const WINE = "#66202A";
const GOLD = "#E1B878";
const INK = "#192735";

const WHO_FOR = [
  {
    title: "Trauma Survivors",
    body: "Individuals who have experienced traumatic events and carry unresolved emotions or memories.",
  },
  {
    title: "Those with Complex Emotional Responses",
    body: "Those who notice distinct shifts in their behavior, mood, or reactions, suggest the presence of distinct parts.",
  },
  {
    title: "Seekers of Self-Understanding",
    body: "Individuals aiming to delve deep into their psyche to understand their behaviors and reactions better.",
  },
  {
    title: "Chronic Stress & Anxiety Sufferers",
    body: "Those who feel their stress or anxiety might be linked to past events or memories.",
  },
];

const APPROACH = [
  {
    title: "Safe Exploration",
    body: "We ensure a secure and supportive environment where individuals can explore their memories and parts without fear or judgment.",
  },
  {
    title: "Trained Therapists",
    body: "Our therapists are specifically trained in Parts and Memory Therapy, ensuring expert guidance throughout the process.",
  },
  {
    title: "Integrative Techniques",
    body: "We combine traditional talk therapy with innovative techniques to access memories and understand parts, ensuring a holistic healing approach.",
  },
  {
    title: "Personalized Sessions",
    body: "Recognizing the deeply personal nature of this therapy, each session is tailored to the individual's pace, comfort, and needs.",
  },
  {
    title: "Continuous Support",
    body: "Beyond the therapy sessions, we offer resources and support to help individuals integrate their learnings into daily life.",
  },
];

export default function PartsMemoryTherapyPage() {
  return (
    <article className="bg-white">
      {/* HERO */}
      <section className="relative overflow-hidden">
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{
            backgroundImage:
              "linear-gradient(rgba(15,22,30,0.55), rgba(15,22,30,0.55)), url('/images/specialties/parts-memory-therapy/01-Brighter-Tomorrow-Parts-Memory-Therapy-4.webp')",
          }}
          aria-hidden
        />
        <div className="relative container-x py-28 sm:py-36 lg:py-44 text-center">
          <Reveal>
            <h1
              className="font-display font-bold leading-tight text-[40px] sm:text-[52px] lg:text-[60px]"
              style={{ color: "#F4F4F4" }}
            >
              <span style={{ color: GOLD }}>Parts &amp; Memory Therapy</span> in Las Vegas, NV
            </h1>
          </Reveal>
        </div>
      </section>

      {/* SECTION 2 — intro */}
      <section className="bg-white">
        <div className="container-x py-20 lg:py-28">
          <div className="grid lg:grid-cols-12 gap-12 lg:gap-16 items-center">
            <Reveal className="lg:col-span-7">
              <p
                className="font-script italic text-[20px] sm:text-[22px]"
                style={{ color: WINE }}
              >
                Creating a brighter tomorrow, today.
              </p>
              <h2
                className="mt-3 font-display font-bold leading-[1.15] text-[30px] sm:text-[38px] lg:text-[42px]"
                style={{ color: INK }}
              >
                Uncover and heal deep-rooted emotional patterns.
              </h2>
              <p className="mt-6 text-[15px] sm:text-[16px] leading-[1.75] text-ink-soft">
                The human psyche is a tapestry of memories and parts, each playing a role in
                shaping our behaviors, reactions, and emotions. At Brighter Tomorrow, we introduce
                Parts and Memory Therapy as a bridge to understanding oneself better, healing past
                traumas, and integrating fragmented parts for a harmonious existence.
              </p>
              <div className="mt-8">
                <Link
                  href="/contact"
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
                    src="/images/specialties/parts-memory-therapy/01-Brighter-Tomorrow-Parts-Memory-Therapy-4.webp"
                    alt="Parts and Memory Therapy"
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

      {/* SECTION 3 — What is Parts & Memory Therapy */}
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
                    src="/images/specialties/parts-memory-therapy/02-Brighter-Tomorrow-Parts-Memory-Therapy-3.webp"
                    alt="Therapist working with a client on parts and memory therapy"
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
                What is Parts &amp; Memory Therapy?
              </h2>
              <p
                className="mt-6 font-display font-semibold text-[18px] sm:text-[20px] leading-[1.65]"
                style={{ color: WINE }}
              >
                Parts and Memory Therapy is a therapeutic approach that focuses on accessing and
                healing traumatic memories while understanding and integrating the different
                &apos;parts&apos; or &apos;subpersonalities&apos; that form an individual&apos;s
                psyche.
              </p>
              <p className="mt-5 text-[16px] leading-[1.8] text-ink-soft">
                These parts often develop as coping mechanisms in response to traumatic events or
                challenging situations. By addressing these memories and parts, individuals can
                release trapped emotions, understand their reactions better, and foster a more
                cohesive sense of self.
              </p>
            </Reveal>
          </div>
        </div>
      </section>

      {/* SECTION 4 — Who is it for (cream card on wine band) */}
      <section style={{ backgroundColor: WINE }} className="relative">
        <div className="bg-cream pt-16 pb-20 px-4 sm:px-6 lg:px-10 mx-3 sm:mx-6 lg:mx-12 rounded-[40px] -my-10 relative z-10">
          <Reveal>
            <h3
              className="text-center font-display font-bold text-[28px] sm:text-[34px] lg:text-[37.5px]"
              style={{ color: INK }}
            >
              Who is Parts &amp; Memory Therapy for?
            </h3>
          </Reveal>

          <div className="mt-12 grid sm:grid-cols-2 lg:grid-cols-4 gap-6 lg:gap-7">
            {WHO_FOR.map(({ title, body }, i) => (
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
                    className="inline-grid place-items-center w-14 h-14 mx-auto rounded-full"
                    style={{ border: `2px solid ${WINE}`, color: WINE }}
                  >
                    <FiChevronRight size={28} strokeWidth={2} />
                  </span>
                  <h4
                    className="mt-3 font-display font-bold text-[18px] sm:text-[20px] leading-[1.3]"
                    style={{ color: INK }}
                  >
                    {title}
                  </h4>
                  <p className="mt-3 text-[14.5px] leading-[1.65] text-ink-soft">{body}</p>
                </motion.div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* SECTION 5 — Our Approach (wine bg) */}
      <section style={{ backgroundColor: WINE }} className="pt-28 pb-20">
        <div className="container-x">
          <div className="grid lg:grid-cols-12 gap-10 lg:gap-12">
            <Reveal className="lg:col-span-4">
              <h3 className="font-display font-bold text-[28px] sm:text-[34px] lg:text-[37.5px] text-white leading-[1.2]">
                Our Approach to Parts &amp; Memory Therapy
              </h3>
              <p className="mt-5 text-white/85 leading-[1.7] text-[15px]">
                With Parts &amp; Memory therapy at Brighter Tomorrow Counseling Center, you will
                receive:
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
                href="/contact"
                className="inline-block font-display font-bold tracking-[0.15em] text-[13px] uppercase px-8 py-4 transition hover:opacity-90"
                style={{ backgroundColor: GOLD, color: INK, borderRadius: "30px 0 30px 30px" }}
              >
                Book an Appointment
              </Link>
            </div>
          </Reveal>
        </div>
      </section>

      {/* Take the first step */}
      <section className="bg-cream-alt py-20 lg:py-24 text-center">
        <Reveal>
          <p className="font-script italic text-[20px] sm:text-[22px]" style={{ color: WINE }}>
            Take the first step
          </p>
          <h3
            className="mt-3 font-display font-bold text-[28px] sm:text-[34px] lg:text-[37.5px] max-w-4xl mx-auto leading-[1.2]"
            style={{ color: INK }}
          >
            Begin Your Healing Journey Today
          </h3>
          <p className="mt-6 max-w-3xl mx-auto text-[15px] sm:text-[16px] leading-[1.75] text-ink-soft">
            Unraveling the layers of one&rsquo;s psyche can be a transformative experience, leading
            to profound self-understanding and healing. At Brighter Tomorrow, we&rsquo;re here to
            guide you every step of the way. Dive deep, heal past wounds, and embrace a harmonious
            existence.
          </p>
          <div className="mt-8">
            <Link
              href="/contact"
              className="inline-block font-display font-bold tracking-[0.15em] text-[13px] uppercase px-8 py-4 transition hover:opacity-90"
              style={{ backgroundColor: GOLD, color: INK, borderRadius: "30px 0 30px 30px" }}
            >
              Book an Appointment
            </Link>
          </div>
        </Reveal>
      </section>

      {/* CTA banner */}
      <section className="relative overflow-hidden" style={{ backgroundColor: "#6E7A8A" }}>
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
