"use client";

import Link from "next/link";
import Image from "next/image";
import { motion } from "framer-motion";
import Reveal from "@/components/Reveal";
import {
  FiCheckCircle,
  FiMapPin,
  FiClock,
  FiHeart,
  FiNavigation,
} from "react-icons/fi";

const WINE = "#66202A";
const GOLD = "#E1B878";
const INK = "#192735";

const BENEFITS = [
  {
    Icon: FiMapPin,
    title: "Remote Individuals",
    body: "Those living in remote areas or places with limited access to mental health resources.",
  },
  {
    Icon: FiClock,
    title: "Busy Schedules",
    body: "Individuals with demanding jobs or responsibilities that make it challenging to attend in-person sessions.",
  },
  {
    Icon: FiHeart,
    title: "Physical Limitations",
    body: "Those with mobility issues or health conditions that make traveling difficult.",
  },
  {
    Icon: FiNavigation,
    title: "Frequent Travelers",
    body: "Those who are often on the move but still want consistent therapeutic support.",
  },
];

const APPROACH = [
  {
    title: "Secure Platforms",
    body: "We prioritize your privacy. Our virtual sessions are conducted on secure platforms, ensuring confidentiality and data protection.",
  },
  {
    title: "Flexible Scheduling",
    body: "Recognizing the diverse needs of our clients, we offer flexible scheduling options, allowing therapy to fit seamlessly into your life.",
  },
  {
    title: "Personalized Care",
    body: "Just like our in-person sessions, our virtual therapy is tailored to each individual's unique needs and challenges.",
  },
  {
    title: "Diverse Modalities",
    body: "From video calls to chat-based sessions, we offer various modalities to suit your comfort and convenience.",
  },
  {
    title: "Continuous Support",
    body: "Our support extends beyond the session. We provide resources, exercises, and tools to integrate healing into daily life.",
  },
];

export default function TeletherapyPage() {
  return (
    <article className="bg-white">
      <section className="relative overflow-hidden">
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{
            backgroundImage:
              "linear-gradient(rgba(15,22,30,0.55), rgba(15,22,30,0.55)), url('/images/services/teletherapy/hero.webp')",
          }}
          aria-hidden
        />
        <div className="relative container-x py-28 sm:py-36 lg:py-44 text-center">
          <Reveal>
            <h1 className="font-display font-bold leading-tight text-[40px] sm:text-[52px] lg:text-[60px]" style={{ color: "#F4F4F4" }}>
              <span style={{ color: GOLD }}>Teletherapy</span> in Las Vegas, NV
            </h1>
          </Reveal>
        </div>
      </section>

      <section className="bg-white">
        <div className="container-x py-20 lg:py-28">
          <div className="grid lg:grid-cols-12 gap-12 lg:gap-16 items-center">
            <Reveal className="lg:col-span-7">
              <h2 className="font-display font-bold leading-[1.15] text-[32px] sm:text-[40px] lg:text-[45px]" style={{ color: INK }}>
                Convenient, confidential therapy from the comfort of home.
              </h2>
              <p className="mt-6 text-[15px] sm:text-[16px] leading-[1.75] text-ink-soft">
                In today&rsquo;s digital age, mental well-being is just a click
                away. At Brighter Tomorrow, we embrace the power of technology
                to bring therapeutic guidance to your doorstep. Virtual therapy
                offers the same quality of care you&rsquo;d expect in person —
                with the added convenience and comfort of accessing it from
                anywhere.
              </p>
              <div className="mt-8">
                <Link href="/contact" className="inline-block font-display font-bold tracking-[0.15em] text-[13px] uppercase px-8 py-4 transition hover:opacity-90" style={{ backgroundColor: GOLD, color: INK, borderRadius: "30px 0 30px 30px" }}>
                  Book an Appointment
                </Link>
              </div>
            </Reveal>
            <Reveal delay={0.1} className="lg:col-span-5">
              <div className="relative mx-auto max-w-[460px]">
                <div className="absolute -bottom-6 -right-6 w-full h-full" style={{ backgroundColor: WINE, borderRadius: "60px 0 60px 60px" }} aria-hidden />
                <motion.div className="relative aspect-[4/5] overflow-hidden" style={{ borderRadius: "60px 0 60px 60px" }} whileHover={{ scale: 1.02 }} transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}>
                  <Image src="/images/services/teletherapy/hero.webp" alt="Person in a virtual therapy session" fill priority sizes="(min-width:1024px) 420px, 100vw" className="object-cover" />
                </motion.div>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      <section className="bg-white">
        <div className="container-x pb-20 lg:pb-28">
          <div className="grid lg:grid-cols-12 gap-12 lg:gap-16 items-center">
            <Reveal className="lg:col-span-5 order-2 lg:order-1">
              <div className="relative mx-auto max-w-[460px]">
                <div className="absolute -bottom-6 -left-6 w-full h-full" style={{ backgroundColor: WINE, borderRadius: "60px 0 60px 60px" }} aria-hidden />
                <motion.div className="relative aspect-[4/5] overflow-hidden" style={{ borderRadius: "60px 0 60px 60px" }} whileHover={{ scale: 1.02 }} transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}>
                  <Image src="/images/services/teletherapy/session.webp" alt="Teletherapy session on laptop" fill sizes="(min-width:1024px) 460px, 100vw" className="object-cover" />
                </motion.div>
              </div>
            </Reveal>
            <Reveal className="lg:col-span-7 order-1 lg:order-2">
              <h2 className="font-display font-bold leading-[1.15] text-[32px] sm:text-[40px] lg:text-[45px]" style={{ color: INK }}>
                What is Teletherapy?
              </h2>
              <p className="mt-6 font-display font-semibold text-[18px] sm:text-[20px] leading-[1.65]" style={{ color: WINE }}>
                Teletherapy, often referred to as online therapy, is a form of
                psychological counseling delivered via digital platforms such as
                video calls, chat, or even email.
              </p>
              <p className="mt-5 text-[16px] leading-[1.8] text-ink-soft">
                It offers the same benefits as traditional face-to-face therapy
                but is conducted through a secure online platform — so you can
                connect with your therapist from anywhere you have a private
                space and an internet connection.
              </p>
              <p className="mt-5 text-[16px] leading-[1.8] text-ink-soft">
                Our support extends beyond the session. We provide resources,
                exercises, and tools to integrate healing into daily life.
              </p>
              <div className="mt-8">
                <Link href="/contact" className="inline-block font-display font-bold tracking-[0.15em] text-[13px] uppercase px-8 py-4 transition hover:opacity-90" style={{ backgroundColor: GOLD, color: INK, borderRadius: "30px 0 30px 30px" }}>
                  Book an Appointment
                </Link>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      <section style={{ backgroundColor: WINE }} className="relative">
        <div className="bg-cream pt-16 pb-20 px-4 sm:px-6 lg:px-10 mx-3 sm:mx-6 lg:mx-12 rounded-[40px] -my-10 relative z-10">
          <Reveal>
            <h3 className="text-center font-display font-bold text-[28px] sm:text-[34px] lg:text-[37.5px]" style={{ color: INK }}>
              Who is Teletherapy For?
            </h3>
          </Reveal>
          <div className="mt-12 grid sm:grid-cols-2 lg:grid-cols-4 gap-6 lg:gap-7">
            {BENEFITS.map(({ Icon, title, body }, i) => (
              <Reveal key={title} delay={i * 0.08}>
                <motion.div whileHover={{ y: -6 }} transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }} className="h-full bg-white p-7 text-center" style={{ borderRadius: "30px 0 30px 30px", border: `1px solid ${i === 0 ? WINE : GOLD}` }}>
                  <span className="inline-grid place-items-center w-14 h-14 mx-auto" style={{ color: WINE }}>
                    <Icon size={36} strokeWidth={1.5} />
                  </span>
                  <h4 className="mt-3 font-display font-bold text-[18px] sm:text-[20px] leading-[1.3]" style={{ color: INK }}>{title}</h4>
                  <p className="mt-3 text-[14.5px] leading-[1.65] text-ink-soft">{body}</p>
                </motion.div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section style={{ backgroundColor: WINE }} className="pt-28 pb-20">
        <div className="container-x">
          <div className="grid lg:grid-cols-12 gap-10 lg:gap-12">
            <Reveal className="lg:col-span-4">
              <h3 className="font-display font-bold text-[28px] sm:text-[34px] lg:text-[37.5px] text-white leading-[1.2]">
                Our Approach to Teletherapy
              </h3>
              <p className="mt-5 text-white/85 leading-[1.7] text-[15px]">
                Virtual sessions, in-person care. Same therapist, same plan,
                from wherever you are.
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
              <Link href="/contact" className="inline-block font-display font-bold tracking-[0.15em] text-[13px] uppercase px-8 py-4 transition hover:opacity-90" style={{ backgroundColor: GOLD, color: INK, borderRadius: "30px 0 30px 30px" }}>
                Book an Appointment
              </Link>
            </div>
          </Reveal>
        </div>
      </section>

      <section className="bg-cream-alt py-20 lg:py-28">
        <div className="container-x max-w-3xl text-center">
          <Reveal>
            <h3 className="font-display font-bold text-[28px] sm:text-[34px] lg:text-[37.5px] leading-[1.2]" style={{ color: INK }}>
              Begin Your Healing Journey Today
            </h3>
            <p className="mt-6 text-[15px] sm:text-[16px] leading-[1.75] text-ink-soft">
              The journey to mental well-being shouldn&rsquo;t be bound by
              location. With Brighter Tomorrow&rsquo;s virtual therapy,
              you&rsquo;re assured expert guidance, no matter where you are.
              Take the step towards a brighter, healthier future, all from the
              comfort of your space.
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
        </div>
      </section>

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
              <Link href="/contact" className="inline-block font-display font-bold tracking-[0.15em] text-[13px] uppercase px-8 py-4 transition hover:opacity-90" style={{ backgroundColor: GOLD, color: INK, borderRadius: "30px 0 30px 30px" }}>
                Consultation Now
              </Link>
            </div>
          </Reveal>
        </div>
      </section>
    </article>
  );
}
