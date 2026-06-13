"use client";

import Link from "next/link";
import Image from "next/image";
import { motion } from "framer-motion";
import Reveal from "@/components/Reveal";
import Counter from "@/components/Counter";
import { FiArrowUpRight, FiChevronRight } from "react-icons/fi";
import { FaQuoteLeft } from "react-icons/fa";

// Brand palette mirrored from brightertomorrowtherapy.com.
const WINE = "#66202A";
const GOLD = "#E1B878";
const INK = "#192735";
const OVERLAY_NAVY = "rgba(25, 39, 53, 0.7)";
const OVERLAY_WINE = "rgba(102, 32, 42, 0.72)";

type Service = {
  title: string;
  body: string;
  img: string;
  href: string;
};

const SERVICES: Service[] = [
  {
    title: "Individual Therapy",
    body: "A tailor-made recovery experience where you can connect with an attentive therapist to overcome doubts, negative thought patterns, and unique challenges.",
    img: "/images/our-approach/svc-individual.webp",
    href: "/services/individual-therapy",
  },
  {
    title: "Group Therapy",
    body: "Immerse yourself in a supportive community that aids in your recovery process, helping you overcome the stigma associated with mental health concerns.",
    img: "/images/our-approach/svc-group.webp",
    href: "/services",
  },
  {
    title: "Couples Counseling",
    body: "Build healthier relationships based on trust, communication, and compromise, removing barriers that hinder your interactions.",
    img: "/images/our-approach/svc-couples.webp",
    href: "/services/couples-counseling",
  },
  {
    title: "Teletherapy",
    body: "Quality mental health support is just a click away, eliminating geographical barriers and providing a convenient alternative to traditional in-person sessions.",
    img: "/images/our-approach/svc-teletherapy.webp",
    href: "/services/teletherapy",
  },
  {
    title: "Parts & Memory Therapy",
    body: "Utilize your body’s innate healing abilities to uncover blocked memories and gain insights into your current self through past experiences.",
    img: "/images/our-approach/svc-memory.webp",
    href: "/services",
  },
  {
    title: "Grief Counseling",
    body: "A significant loss can feel overwhelming, isolating, and impossible to navigate alone. We offer grief counseling to help you process the loss of a loved one, manage difficult emotions, and find a path forward.",
    img: "/images/our-approach/svc-grief.webp",
    href: "/specialties/grief-counseling",
  },
];

type Testimonial = { quote: string };

const TESTIMONIALS: Testimonial[] = [
  {
    quote:
      "My therapist has been working with my children for two years. She has been supportive and helpful as they transition in age and with their struggles in life. I am happy she continues to assist them.",
  },
  {
    quote:
      "Awesome, is the one word that describe the atmosphere. The interactions with staff have been impressive! Keep up the great work.",
  },
  {
    quote:
      "My therapist helps me process my experiences in justice work. Talking with her is like a deep, clearing breath for my mind. Everyone should find a therapist, even if it takes a few tries to find the right match.",
  },
  {
    quote:
      "My therapist is the best! She always listens and cares. I am extremely satisfied with the treatment.",
  },
];

const SPECIALTIES = [
  "Trauma",
  "Anxiety",
  "Depression",
  "Addiction",
  "Relationship challenges",
  "Or other mental health concerns",
];

const STATS = [
  { to: 7, suffix: "+", label: "Years Experience" },
  { to: 500, suffix: "+", label: "Happy Patients" },
  { to: 98, suffix: "%", label: "Mental Healing" },
  { to: 6, suffix: "", label: "Therapists" },
];

const cardVariants = {
  hidden: { opacity: 0, y: 40 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] },
  },
};

export default function OurApproachPage() {
  return (
    <article className="bg-white">
      {/* HERO — photo bg + navy overlay */}
      <section className="relative overflow-hidden">
        <div
          aria-hidden
          className="absolute inset-0 bg-cover bg-center"
          style={{
            backgroundImage: `linear-gradient(${OVERLAY_NAVY}, ${OVERLAY_NAVY}), url('/images/our-approach/hero-bg.webp')`,
          }}
        />
        <div className="relative container-x py-28 sm:py-36 lg:py-44 text-center">
          <Reveal direction="up">
            <h1
              className="font-display font-bold leading-[1.1] text-[40px] sm:text-[52px] lg:text-[60px]"
              style={{ color: "#F4F4F4" }}
            >
              <span style={{ color: GOLD, fontStyle: "italic" }}>Our</span>{" "}
              Approach
            </h1>
            <svg
              aria-hidden
              viewBox="0 0 200 8"
              className="mx-auto mt-7 w-36 h-2"
              style={{ color: GOLD }}
            >
              <path
                d="M2 5 Q 50 0 100 4 T 198 5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </Reveal>
        </div>
      </section>

      {/* MISSION — text left, image w/ wine asymmetric backing right */}
      <section className="bg-white overflow-hidden">
        <div className="container-x py-20 lg:py-28">
          <div className="grid lg:grid-cols-12 gap-12 lg:gap-16 items-center">
            <Reveal direction="left" className="lg:col-span-7">
              <span
                className="font-display font-semibold tracking-[0.18em] uppercase text-[12px]"
                style={{ color: WINE }}
              >
                Brighter Tomorrow Counseling
              </span>
              <h2
                className="mt-5 font-display font-bold leading-[1.15] text-[32px] sm:text-[40px] lg:text-[45px]"
                style={{ color: INK }}
              >
                Our <span style={{ color: WINE, fontStyle: "italic" }}>Mission.</span>
              </h2>
              <p
                className="mt-7 font-display text-[22px] sm:text-[26px] leading-[1.3]"
                style={{ color: INK }}
              >
                To make therapy and counseling{" "}
                <span style={{ color: WINE, fontStyle: "italic" }}>
                  accessible to everyone,
                </span>{" "}
                regardless of age or background.
              </p>
              <p className="mt-6 text-ink-muted text-[16px] leading-[1.8]">
                We believe that everyone deserves a brighter future, and our
                name encapsulates our commitment to guiding you toward a
                brighter tomorrow. Our holistic approach is tailored to your
                unique experiences, ensuring that you feel understood,
                supported, and empowered throughout your healing journey.
              </p>
              <div className="mt-8">
                <Link
                  href="/story"
                  className="inline-flex items-center gap-2 font-display font-bold tracking-[0.15em] text-[13px] uppercase px-8 py-4 transition hover:opacity-90"
                  style={{
                    backgroundColor: GOLD,
                    color: INK,
                    borderRadius: "30px 0 30px 30px",
                  }}
                >
                  Our Story <FiArrowUpRight />
                </Link>
              </div>
            </Reveal>

            <Reveal direction="right" delay={0.1} className="lg:col-span-5">
              <div className="relative mx-auto max-w-[460px]">
                <div
                  aria-hidden
                  className="absolute -bottom-6 -right-6 w-full h-full"
                  style={{
                    backgroundColor: WINE,
                    borderRadius: "60px 0 60px 60px",
                  }}
                />
                <motion.div
                  className="relative aspect-[2/3] overflow-hidden"
                  style={{ borderRadius: "60px 0 60px 60px" }}
                  whileHover={{ scale: 1.02 }}
                  transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                >
                  <Image
                    src="/images/our-approach/mission.webp"
                    alt="Brighter Tomorrow team in a supportive group setting"
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

      {/* STATS — photo bg + wine overlay + animated counters */}
      <section
        className="relative overflow-hidden"
        style={{
          backgroundImage: "url('/images/our-approach/stats-bg.jpg')",
          backgroundSize: "cover",
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
        }}
      >
        <div
          aria-hidden
          className="absolute inset-0"
          style={{ backgroundColor: OVERLAY_WINE }}
        />
        <div className="container-x relative grid grid-cols-2 md:grid-cols-4 gap-4 sm:gap-5 lg:gap-6 py-16 lg:py-20 text-center">
          {STATS.map((s, i) => (
            <motion.div
              key={s.label}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.3 }}
              transition={{ duration: 0.55, delay: i * 0.08 }}
              style={{ color: GOLD }}
            >
              <Counter
                to={s.to}
                suffix={s.suffix}
                className="font-display text-4xl sm:text-5xl md:text-6xl font-bold tracking-tight tabular-nums"
              />
              <div className="text-white/90 text-xs sm:text-sm uppercase tracking-[0.18em] mt-3 font-semibold">
                {s.label}
              </div>
            </motion.div>
          ))}
        </div>
      </section>

      {/* SERVICES — 6 image cards, cream bg */}
      <section className="bg-cream py-20 lg:py-28">
        <div className="container-x">
          <Reveal>
            <div className="text-center max-w-2xl mx-auto mb-14">
              <span
                className="font-display font-semibold tracking-[0.18em] uppercase text-[12px]"
                style={{ color: WINE }}
              >
                Our Services
              </span>
              <h2
                className="mt-5 font-display font-bold text-[32px] sm:text-[40px] lg:text-[45px] leading-[1.15]"
                style={{ color: INK }}
              >
                How Our Therapists in Las Vegas, NV,{" "}
                <span style={{ color: WINE, fontStyle: "italic" }}>
                  Can Help.
                </span>
              </h2>
            </div>
          </Reveal>
          <motion.div
            className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8"
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, amount: 0.1 }}
            transition={{ staggerChildren: 0.1 }}
          >
            {SERVICES.map((s) => (
              <motion.div key={s.title} variants={cardVariants}>
                <Link
                  href={s.href}
                  className="group block h-full bg-white border border-surface-line overflow-hidden shadow-soft hover:shadow-card hover:border-brand hover:-translate-y-1 transition-all duration-500"
                  style={{ borderRadius: "30px 0 30px 30px" }}
                >
                  <div className="aspect-square overflow-hidden bg-cream-alt">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={s.img}
                      alt=""
                      className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-[1.07]"
                      loading="lazy"
                    />
                  </div>
                  <div className="p-7 lg:p-8 text-center">
                    <h3
                      className="font-display font-bold text-[22px] leading-tight"
                      style={{ color: INK }}
                    >
                      {s.title}
                    </h3>
                    <p className="mt-4 text-ink-muted text-[14.5px] leading-[1.7]">
                      {s.body}
                    </p>
                    <div
                      className="mt-5 inline-flex items-center gap-2 text-[12px] font-display font-bold uppercase tracking-[0.15em]"
                      style={{ color: WINE }}
                    >
                      Read More
                      <FiArrowUpRight size={14} />
                    </div>
                  </div>
                </Link>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* SPECIALTIES — image left (asymmetric wine backing), text right */}
      <section className="bg-white py-20 lg:py-28 overflow-hidden">
        <div className="container-x grid lg:grid-cols-12 gap-12 lg:gap-16 items-center">
          <Reveal direction="left" className="lg:col-span-5 order-2 lg:order-1">
            <div className="relative mx-auto max-w-[460px]">
              <div
                aria-hidden
                className="absolute -bottom-6 -left-6 w-full h-full"
                style={{
                  backgroundColor: WINE,
                  borderRadius: "60px 0 60px 60px",
                }}
              />
              <motion.div
                className="relative aspect-[2/3] overflow-hidden"
                style={{ borderRadius: "60px 0 60px 60px" }}
                whileHover={{ scale: 1.02 }}
                transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
              >
                <Image
                  src="/images/our-approach/specialties.webp"
                  alt="Therapist taking notes during a counseling session"
                  fill
                  sizes="(min-width:1024px) 460px, 100vw"
                  className="object-cover"
                />
              </motion.div>
            </div>
          </Reveal>

          <Reveal direction="right" delay={0.1} className="lg:col-span-7 order-1 lg:order-2">
            <span
              className="font-display font-semibold tracking-[0.18em] uppercase text-[12px]"
              style={{ color: WINE }}
            >
              Our Specialties
            </span>
            <h2
              className="mt-5 font-display font-bold leading-[1.15] text-[32px] sm:text-[40px] lg:text-[45px]"
              style={{ color: INK }}
            >
              Expertise that meets you{" "}
              <span style={{ color: WINE, fontStyle: "italic" }}>
                where you are.
              </span>
            </h2>
            <p className="mt-7 text-ink-muted text-[16px] leading-[1.8]">
              Our team of seasoned therapists brings a diverse range of
              expertise. We ensure that each client&rsquo;s therapy journey is
              unique by matching them with therapists who truly understand
              their struggles. Whether you&rsquo;re dealing with:
            </p>
            <ul className="mt-6 space-y-3">
              {SPECIALTIES.map((label, i) => (
                <motion.li
                  key={label}
                  initial={{ opacity: 0, x: -16 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true, amount: 0.4 }}
                  transition={{ duration: 0.5, delay: i * 0.06 }}
                  className="flex items-center gap-3 text-[16px]"
                  style={{ color: INK }}
                >
                  <FiChevronRight
                    size={18}
                    className="shrink-0"
                    style={{ color: WINE }}
                  />
                  <span>{label}</span>
                </motion.li>
              ))}
            </ul>
            <p className="mt-7 text-ink-muted text-[16px] leading-[1.8]">
              Our specialists are equipped to provide personalized care that
              addresses your specific needs.
            </p>
          </Reveal>
        </div>
      </section>

      {/* TESTIMONIALS — client reviews, cream bg (mirrors .com /approach) */}
      <section className="bg-cream py-20 lg:py-28">
        <div className="container-x">
          <Reveal>
            <div className="text-center max-w-2xl mx-auto mb-14">
              <span
                className="font-display font-semibold tracking-[0.18em] uppercase text-[12px]"
                style={{ color: WINE }}
              >
                Client Reviews
              </span>
              <h2
                className="mt-5 font-display font-bold text-[32px] sm:text-[40px] lg:text-[45px] leading-[1.15]"
                style={{ color: INK }}
              >
                Stories of{" "}
                <span style={{ color: WINE, fontStyle: "italic" }}>
                  brighter tomorrows.
                </span>
              </h2>
            </div>
          </Reveal>
          <motion.div
            className="grid sm:grid-cols-2 gap-6 lg:gap-8"
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, amount: 0.1 }}
            transition={{ staggerChildren: 0.1 }}
          >
            {TESTIMONIALS.map((t, i) => (
              <motion.figure
                key={i}
                variants={cardVariants}
                className="h-full bg-white border border-surface-line p-7 lg:p-9 shadow-soft hover:shadow-card transition-shadow duration-500"
                style={{ borderRadius: "30px 0 30px 30px" }}
              >
                <FaQuoteLeft size={26} style={{ color: GOLD }} />
                <blockquote className="mt-5 text-ink-muted text-[16px] leading-[1.8]">
                  {t.quote}
                </blockquote>
                <figcaption className="mt-7 flex items-center gap-4">
                  <span
                    aria-hidden
                    className="grid place-items-center w-11 h-11 font-display font-bold text-[15px]"
                    style={{
                      backgroundColor: WINE,
                      color: "#FFFFFF",
                      borderRadius: "16px 0 16px 16px",
                    }}
                  >
                    BT
                  </span>
                  <span className="leading-tight">
                    <span
                      className="block font-display font-bold text-[16px]"
                      style={{ color: INK }}
                    >
                      Client
                    </span>
                    <span
                      className="block text-[13px]"
                      style={{ color: WINE }}
                    >
                      Brighter Tomorrow
                    </span>
                  </span>
                </figcaption>
              </motion.figure>
            ))}
          </motion.div>
        </div>
      </section>

      {/* CTA — slate background mirroring .com /approach bottom */}
      <section
        className="relative overflow-hidden"
        style={{ backgroundColor: "#6E7A8A" }}
      >
        <div
          aria-hidden
          className="absolute inset-0 opacity-30 bg-cover bg-center"
          style={{ backgroundImage: "url('/images/our-approach/cta-bg.jpg')" }}
        />
        <div className="container-x py-20 lg:py-24 text-center relative z-10">
          <Reveal direction="up">
            <p
              className="font-script italic text-[20px] sm:text-[24px]"
              style={{ color: GOLD }}
            >
              Ready to begin your healing journey?
            </p>
            <h3 className="mt-3 font-display font-bold text-[32px] sm:text-[40px] lg:text-[45px] text-white leading-[1.15]">
              Take the first step on the path toward a{" "}
              <span style={{ color: GOLD }}>brighter tomorrow!</span>
            </h3>
            <div className="mt-8 flex justify-center">
              <Link
                href="/contact"
                className="inline-flex items-center gap-2 font-display font-bold tracking-[0.15em] text-[13px] uppercase px-8 py-4 transition hover:opacity-90"
                style={{
                  backgroundColor: GOLD,
                  color: INK,
                  borderRadius: "30px 0 30px 30px",
                }}
              >
                Consultation Now <FiArrowUpRight />
              </Link>
            </div>
          </Reveal>
        </div>
      </section>
    </article>
  );
}
