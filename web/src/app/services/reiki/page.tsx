"use client";

import Link from "next/link";
import Image from "next/image";
import { motion } from "framer-motion";
import Reveal from "@/components/Reveal";
import {
  FiCheckCircle,
  FiChevronRight,
  FiSun,
  FiActivity,
  FiZap,
  FiUser,
} from "react-icons/fi";

const WINE = "#66202A";
const GOLD = "#E1B878";
const INK = "#192735";

const BENEFITS = [
  {
    Icon: FiSun,
    title: "Enhanced Well-being",
    body: "Experience a notable improvement in your physical, emotional, and spiritual well-being.",
  },
  {
    Icon: FiActivity,
    title: "Stress Reduction",
    body: "Navigate through life's challenges with reduced stress and enhanced coping mechanisms.",
  },
  {
    Icon: FiZap,
    title: "Improved Focus and Clarity",
    body: "Gain better control over your mind, enhancing focus and mental clarity.",
  },
  {
    Icon: FiUser,
    title: "Empowered Self",
    body: "Strengthen your inner self, enhancing your body's natural healing processes and fostering personal growth.",
  },
];

const APPROACH = [
  {
    title: "Personalized Sessions",
    body: "Tailoring each session to meet your unique physical, emotional, and spiritual needs.",
  },
  {
    title: "Expert Practitioners",
    body: "Provide experienced yoga instructors and Reiki masters to guide your sessions.",
  },
  {
    title: "Holistic Wellness",
    body: "Addressing not just symptoms, but enhancing overall well-being and life balance.",
  },
  {
    title: "Supportive Environment",
    body: "Creating a safe, nurturing space where you can explore and enhance your inner self.",
  },
];

const WHO_FOR = [
  "Seek a holistic method to manage stress, anxiety, or depression.",
  "Desire to enhance your emotional, physical, and spiritual well-being.",
  "Are navigating through a period of grief or transition.",
  "Wish to improve your focus, clarity, and inner peace.",
  "Want to enhance your body's natural healing capabilities.",
];

const DISTANCE = [
  "Receiving healing support from the comfort of your own home",
  "Eliminating travel time and stress",
  "Feeling safer and more relaxed in a familiar environment",
  "Access to care even when traveling or living outside the local area",
  "Greater flexibility for busy schedules",
];

export default function ReikiPage() {
  return (
    <article className="bg-white">
      {/* HERO — dark bg image, centered title */}
      <section className="relative overflow-hidden">
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{
            backgroundImage:
              "linear-gradient(rgba(15,22,30,0.55), rgba(15,22,30,0.55)), url('/images/reiki/reiki-hero-bg.webp')",
          }}
          aria-hidden
        />
        <div className="relative container-x py-28 sm:py-36 lg:py-44 text-center">
          <Reveal>
            <h1
              className="font-display font-bold leading-tight text-[40px] sm:text-[52px] lg:text-[60px]"
              style={{ color: "#F4F4F4" }}
            >
              <span style={{ color: GOLD }}>Reiki</span> in Las Vegas, NV
            </h1>
          </Reveal>
        </div>
      </section>

      {/* SECTION 2 — A holistic approach + chakra image */}
      <section className="bg-white">
        <div className="container-x py-20 lg:py-28">
          <div className="grid lg:grid-cols-12 gap-12 lg:gap-16 items-center">
            <Reveal className="lg:col-span-7">
              <h2
                className="font-display font-bold leading-[1.15] text-[32px] sm:text-[40px] lg:text-[45px]"
                style={{ color: INK }}
              >
                A holistic approach to improved health and wellbeing.
              </h2>
              <p
                className="mt-6 text-[15px] sm:text-[16px] leading-[1.75] text-ink-soft"
              >
                At Brighter Tomorrow, we embrace a comprehensive approach to
                Reiki therapy.
              </p>
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
                    src="/images/reiki/reiki-hero.jpg"
                    alt="Reiki energy chakra visualization"
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

      {/* SECTION 3 — What is Yoga and Reiki? */}
      <section className="bg-white">
        <div className="container-x pb-20 lg:pb-28">
          <div className="grid lg:grid-cols-12 gap-12 lg:gap-16 items-center">
            <Reveal className="lg:col-span-5 order-2 lg:order-1">
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
                    src="/images/reiki/reiki-session.webp"
                    alt="Reiki practitioner with singing bowl during a session"
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
                What is Yoga and Reiki?
              </h2>
              <p
                className="mt-6 font-display font-semibold text-[18px] sm:text-[20px] leading-[1.65]"
                style={{ color: WINE }}
              >
                Reiki is a gentle energy-based wellness practice that originated
                in Japan. During a session, a practitioner intentionally directs
                healing energy to support the body&rsquo;s natural ability to
                restore balance. This may be done through light touch or by
                holding the hands just above the body.
              </p>
              <p className="mt-5 text-[16px] leading-[1.8] text-ink-soft">
                The experience is deeply calming. Many people report feeling a
                sense of warmth, softness, or subtle waves of relaxation as
                their nervous system begins to settle. Reiki encourages
                emotional release, mental clarity, and physical ease by helping
                to reduce stress and energetic tension stored in the body.
              </p>
              <p className="mt-5 text-[16px] leading-[1.8] text-ink-soft">
                Rather than &ldquo;fixing&rdquo; something, Reiki supports your
                system in doing what it was designed to do — regulate,
                rebalance, and renew. By encouraging healthy energy flow
                throughout the body, this practice nurtures alignment across
                mind, body, and spirit.
              </p>
              <p className="mt-5 text-[16px] leading-[1.8] text-ink-soft">
                Clients often leave sessions feeling lighter, more centered,
                grounded, and reconnected to themselves.
              </p>
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
                  Book an Appointment
                </Link>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* SECTION 4 — Benefits of Reiki (cream card sandwiched in wine bands) */}
      <section style={{ backgroundColor: WINE }} className="relative">
        <div className="bg-cream pt-16 pb-20 px-4 sm:px-6 lg:px-10 mx-3 sm:mx-6 lg:mx-12 rounded-[40px] -my-10 relative z-10">
          <Reveal>
            <h3
              className="text-center font-display font-bold text-[28px] sm:text-[34px] lg:text-[37.5px]"
              style={{ color: INK }}
            >
              Benefits of Reiki
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

      {/* SECTION 5 — Our Approach to Reiki (wine bg, white text) */}
      <section style={{ backgroundColor: WINE }} className="pt-28 pb-20">
        <div className="container-x">
          <div className="grid lg:grid-cols-12 gap-10 lg:gap-12">
            <Reveal className="lg:col-span-4">
              <h3 className="font-display font-bold text-[28px] sm:text-[34px] lg:text-[37.5px] text-white leading-[1.2]">
                Our Approach to Reiki
              </h3>
              <p className="mt-5 text-white/85 leading-[1.7] text-[15px]">
                At Brighter Tomorrow, we embrace a comprehensive approach to
                Reiki therapy long distance by providing service virtually
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
                href="/contact"
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

      {/* SECTION 6 — Who is it for + Distance benefits (2 cols, light bg) */}
      <section className="bg-cream-alt py-20 lg:py-28">
        <div className="container-x grid md:grid-cols-2 gap-12 lg:gap-16">
          <Reveal>
            <p
              className="text-center mx-auto max-w-[280px] font-display text-[18px] leading-[1.55]"
              style={{ color: INK }}
            >
              This therapeutic approach may be particularly beneficial if you:
            </p>
            <ul className="mt-8 space-y-4">
              {WHO_FOR.map((item, i) => (
                <motion.li
                  key={item}
                  initial={{ opacity: 0, x: -16 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true, amount: 0.4 }}
                  transition={{ duration: 0.5, delay: i * 0.06 }}
                  className="flex items-start gap-3 text-[15px] text-ink-soft leading-[1.65]"
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
          </Reveal>

          <Reveal delay={0.08}>
            <p
              className="text-center mx-auto max-w-[420px] font-display text-[18px] leading-[1.6]"
              style={{ color: INK }}
            >
              Live virtual Reiki sessions offer the same intentional energy
              support — without needing to be in the same physical space.
              Because Reiki works with energy rather than physical manipulation,
              it can be facilitated effectively at a distance.
            </p>
            <ul className="mt-8 space-y-4">
              {DISTANCE.map((item, i) => (
                <motion.li
                  key={item}
                  initial={{ opacity: 0, x: -16 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true, amount: 0.4 }}
                  transition={{ duration: 0.5, delay: i * 0.06 }}
                  className="flex items-start gap-3 text-[15px] text-ink-soft leading-[1.65]"
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
          </Reveal>
        </div>
      </section>

      {/* SECTION 7 — CTA banner */}
      <section
        className="relative overflow-hidden"
        style={{ backgroundColor: "#6E7A8A" }}
      >
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
