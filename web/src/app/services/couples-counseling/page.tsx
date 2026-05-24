"use client";

import Link from "next/link";
import Image from "next/image";
import { motion } from "framer-motion";
import Reveal from "@/components/Reveal";
import {
  FiCheckCircle,
  FiCompass,
  FiMessageCircle,
  FiHeart,
  FiStar,
} from "react-icons/fi";

const WINE = "#66202A";
const GOLD = "#E1B878";
const INK = "#192735";

const BENEFITS = [
  {
    Icon: FiCompass,
    title: "Navigate Challenges",
    body: "For couples facing specific issues — infidelity, financial disagreements, or differing parenting styles — couples therapy can help.",
  },
  {
    Icon: FiMessageCircle,
    title: "Enhanced Communication",
    body: "For couples looking to improve their communication patterns and understand each other better.",
  },
  {
    Icon: FiHeart,
    title: "Premarital Counseling",
    body: "Engaged couples can seek guidance as they prepare for marriage, ensuring they start on a strong foundation.",
  },
  {
    Icon: FiStar,
    title: "Rekindling the Spark",
    body: "Long-term partners feeling distant or looking to reignite the passion and intimacy in their relationship.",
  },
];

const APPROACH = [
  {
    title: "Tailored Sessions",
    body: "Recognizing that every relationship is unique, our therapy sessions are tailored to address the specific challenges and dynamics of each couple.",
  },
  {
    title: "Neutral Ground",
    body: "We provide a safe, non-judgmental space where both partners can express their feelings and concerns openly.",
  },
  {
    title: "Skill Building",
    body: "Beyond addressing issues, we focus on equipping couples with tools and strategies to handle future challenges, from effective communication to conflict resolution.",
  },
  {
    title: "Holistic Healing",
    body: "We consider the individual well-being of each partner, understanding that a strong relationship is built on the well-being of both individuals.",
  },
  {
    title: "Confidentiality Assured",
    body: "Our sessions are strictly confidential, ensuring that couples can share without reservations.",
  },
];

export default function CouplesCounselingPage() {
  return (
    <article className="bg-white">
      <section className="relative overflow-hidden">
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{
            backgroundImage:
              "linear-gradient(rgba(15,22,30,0.55), rgba(15,22,30,0.55)), url('/images/services/couples-counseling/hero.webp')",
          }}
          aria-hidden
        />
        <div className="relative container-x py-28 sm:py-36 lg:py-44 text-center">
          <Reveal>
            <h1 className="font-display font-bold leading-tight text-[40px] sm:text-[52px] lg:text-[60px]" style={{ color: "#F4F4F4" }}>
              <span style={{ color: GOLD }}>Couples Counseling</span> in Las Vegas, NV
            </h1>
          </Reveal>
        </div>
      </section>

      <section className="bg-white">
        <div className="container-x py-20 lg:py-28">
          <div className="grid lg:grid-cols-12 gap-12 lg:gap-16 items-center">
            <Reveal className="lg:col-span-7">
              <h2 className="font-display font-bold leading-[1.15] text-[32px] sm:text-[40px] lg:text-[45px]" style={{ color: INK }}>
                Strengthen your relationship with expert guidance and support.
              </h2>
              <p className="mt-6 text-[15px] sm:text-[16px] leading-[1.75] text-ink-soft">
                Relationships, with all their beauty and complexity, sometimes
                require guidance to navigate challenges. At Brighter Tomorrow,
                we offer couples therapy as a beacon of hope — helping partners
                rediscover their bond, communicate effectively, and build a
                stronger foundation for the future.
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
                  <Image src="/images/services/couples-counseling/hero.webp" alt="Couple in therapy session" fill priority sizes="(min-width:1024px) 420px, 100vw" className="object-cover" />
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
                  <Image src="/images/services/couples-counseling/session.webp" alt="Couple holding hands during counseling" fill sizes="(min-width:1024px) 460px, 100vw" className="object-cover" />
                </motion.div>
              </div>
            </Reveal>
            <Reveal className="lg:col-span-7 order-1 lg:order-2">
              <h2 className="font-display font-bold leading-[1.15] text-[32px] sm:text-[40px] lg:text-[45px]" style={{ color: INK }}>
                What is Couples Therapy?
              </h2>
              <p className="mt-6 font-display font-semibold text-[18px] sm:text-[20px] leading-[1.65]" style={{ color: WINE }}>
                Couples therapy is a specialized form of psychotherapy aimed at
                helping partners identify, address, and resolve conflicts and
                improve their relationship.
              </p>
              <p className="mt-5 text-[16px] leading-[1.8] text-ink-soft">
                Through guided sessions, couples gain insights into their
                relationship dynamics, learn to communicate more effectively,
                and develop strategies to address recurring issues.
              </p>
              <p className="mt-5 text-[16px] leading-[1.8] text-ink-soft">
                The ultimate goal is to foster understanding, rebuild trust, and
                strengthen the bond between partners — so the relationship can
                grow stronger together.
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
              Benefits of Couples Therapy
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
                Our Approach to Couples Therapy
              </h3>
              <p className="mt-5 text-white/85 leading-[1.7] text-[15px]">
                We meet every couple where they are — without judgment, with the
                tools to move forward together.
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
              Every relationship has its ups and downs, but with the right
              guidance, challenges can be transformed into opportunities for
              growth and deeper connection. At Brighter Tomorrow, we&rsquo;re
              committed to guiding you and your partner toward a harmonious,
              fulfilling relationship. Take the first step towards a brighter
              future together.
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
              Begin your healing journey today.
            </p>
            <h3 className="mt-3 font-display font-bold text-[32px] sm:text-[40px] lg:text-[45px] text-white leading-[1.15]">
              Take the first step on the path toward a{" "}
              <span style={{ color: GOLD }}>brighter tomorrow</span>!
            </h3>
            <div className="mt-8">
              <Link href="/contact" className="inline-block font-display font-bold tracking-[0.15em] text-[13px] uppercase px-8 py-4 transition hover:opacity-90" style={{ backgroundColor: GOLD, color: INK, borderRadius: "30px 0 30px 30px" }}>
                Book an Appointment
              </Link>
            </div>
          </Reveal>
        </div>
      </section>
    </article>
  );
}
