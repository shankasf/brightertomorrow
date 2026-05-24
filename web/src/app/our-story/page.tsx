"use client";

import Link from "next/link";
import Image from "next/image";
import { motion } from "framer-motion";
import Reveal from "@/components/Reveal";
import Counter from "@/components/Counter";
import { FiArrowUpRight, FiCheckCircle } from "react-icons/fi";

// Brand palette mirrored from brightertomorrowtherapy.com /story.
const WINE = "#66202A";
const GOLD = "#E1B878";
const INK = "#192735";
const OVERLAY_NAVY = "rgba(25, 39, 53, 0.7)";
const OVERLAY_WINE = "rgba(102, 32, 42, 0.72)";

const STATS = [
  { to: 7, suffix: "+", label: "Years Experience" },
  { to: 500, suffix: "+", label: "Happy Patients" },
  { to: 98, suffix: "%", label: "Mental Healing" },
  { to: 6, suffix: "", label: "Therapists" },
];

const SPECIALTIES_INCLUDE = [
  {
    title: "Chronic Illnesses & Dialysis-Related Mental Health Support",
    body: "We provide emotional support for those navigating chronic illnesses and the emotional impacts of dialysis, helping you maintain a sense of hope and well-being throughout your journey.",
  },
  {
    title: "Chronic Pain Management & Emotional Well-being",
    body: "Managing chronic pain is not only about physical care but also emotional resilience. Our therapists help you develop coping strategies to maintain a positive outlook and improve your quality of life.",
  },
  {
    title: "Grief & Loss Counseling",
    body: "Whether it’s the loss of a loved one or the grief that comes with chronic illness or life changes, we offer a safe space to process your emotions and work through the complexities of loss.",
  },
  {
    title: "Life Transitions & Relationship Challenges",
    body: "Major life changes can be overwhelming. We offer guidance and support as you navigate transitions, helping you rebuild confidence in your relationships and find new pathways forward.",
  },
];

export default function OurStoryPage() {
  return (
    <article className="bg-white">
      {/* HERO — photo bg + navy overlay */}
      <section className="relative overflow-hidden">
        <div
          aria-hidden
          className="absolute inset-0 bg-cover bg-center"
          style={{
            backgroundImage: `linear-gradient(${OVERLAY_NAVY}, ${OVERLAY_NAVY}), url('/images/our-story/hero-bg.webp')`,
          }}
        />
        <div className="relative container-x py-28 sm:py-36 lg:py-44 text-center">
          <Reveal direction="up">
            <h1
              className="font-display font-bold leading-[1.1] text-[40px] sm:text-[52px] lg:text-[60px]"
              style={{ color: "#F4F4F4" }}
            >
              <span style={{ color: GOLD, fontStyle: "italic" }}>Our</span>{" "}
              Story
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

      {/* TAGLINE block */}
      <section className="bg-white pt-20 lg:pt-28">
        <div className="container-narrow text-center">
          <Reveal>
            <h2
              className="font-display font-bold text-[34px] sm:text-[44px] lg:text-[54px] leading-[1.15]"
              style={{ color: INK }}
            >
              Everyone deserves a{" "}
              <span style={{ color: WINE, fontStyle: "italic" }}>
                Brighter Tomorrow.
              </span>
            </h2>
            <p className="mt-6 text-ink-muted text-[18px] sm:text-[20px] leading-[1.7] max-w-2xl mx-auto">
              Our personalized therapy approach provides an authentic journey
              toward a brighter future.
            </p>
          </Reveal>
        </div>
      </section>

      {/* JOURNEY body + founder portrait */}
      <section className="bg-white py-16 lg:py-20">
        <div className="container-x grid lg:grid-cols-[1.35fr_1fr] gap-12 lg:gap-20 items-start">
          <Reveal direction="left">
            <div>
              <p
                className="text-[18px] sm:text-[20px] leading-[1.55] font-semibold"
                style={{ color: INK }}
              >
                Our journey began in 2018 when Yvette Howard took the bold step
                of establishing a solo practice.
              </p>
              <p className="mt-6 text-ink-muted text-[16px] leading-[1.8]">
                By 2019, she fully committed to her vision, stepping down from
                her part-time job to focus entirely on her private practice.
                The advent of Covid-19 catalyzed the shift towards telehealth
                and virtual counseling, allowing us to reach more individuals
                in need. Our team began to grow organically; an associate,
                unhappy in their previous role, joined us, and soon after,
                brought in another colleague. By 2021, through networking
                events and word of mouth, our team expanded to include five
                dedicated counselors. Since then, we have continued to grow as
                a practice dedicated to providing a better tomorrow for all our
                clients.
              </p>
              <p className="mt-5 text-ink-muted text-[16px] leading-[1.8]">
                Yvette is passionate about utilizing best practices to enhance
                the careers and professionalism of interns. Our mission is to
                empower them to thrive as therapists under our banner or to
                confidently establish their own private practices. We
                prioritize self-care for our team and interns, ensuring they
                are well-prepared for their professional journey and for
                helping clients get the most out of their therapeutic journey
                into a brighter future.
              </p>
              <p className="mt-5 text-ink-muted text-[16px] leading-[1.8]">
                While we believe that the core of counseling remains consistent
                across different modalities, our team&rsquo;s willingness to
                continuously learn and adapt sets us apart. We&rsquo;re always
                open to exploring new methods, such as the parts and memory
                modality. Our prompt responses, welcoming nature, and
                approachability have been highlighted by many as reasons they
                chose us.
              </p>
            </div>
          </Reveal>

          <Reveal direction="right" delay={0.1}>
            <div className="relative lg:sticky lg:top-28 mx-auto max-w-[460px]">
              <div
                aria-hidden
                className="absolute -bottom-6 -right-6 w-full h-full"
                style={{
                  backgroundColor: WINE,
                  borderRadius: "60px 0 60px 60px",
                }}
              />
              <motion.div
                className="relative aspect-[495/512] overflow-hidden"
                style={{ borderRadius: "60px 0 60px 60px" }}
                whileHover={{ scale: 1.02 }}
                transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
              >
                <Image
                  src="/images/our-story/founder.jpg"
                  alt="Yvette Howard, founder of Brighter Tomorrow Therapy"
                  fill
                  priority
                  sizes="(min-width:1024px) 460px, 100vw"
                  className="object-cover"
                />
              </motion.div>
              <p
                className="mt-6 font-script italic text-[22px] text-center"
                style={{ color: WINE }}
              >
                — Yvette Howard, Founder
              </p>
            </div>
          </Reveal>
        </div>
      </section>

      {/* STATS — photo bg + wine overlay */}
      <section
        className="relative overflow-hidden"
        style={{
          backgroundImage: "url('/images/our-story/stats-bg.jpg')",
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
                className="font-display text-4xl sm:text-5xl md:text-6xl font-bold tracking-tight"
              />
              <div className="text-white/90 text-xs sm:text-sm uppercase tracking-[0.18em] mt-3 font-semibold">
                {s.label}
              </div>
            </motion.div>
          ))}
        </div>
      </section>

      {/* BEHIND THE NAME */}
      <section className="bg-cream py-20 lg:py-28">
        <div className="container-narrow">
          <Reveal>
            <div className="text-center">
              <span
                className="font-display font-semibold tracking-[0.18em] uppercase text-[12px]"
                style={{ color: WINE }}
              >
                Behind the Name
              </span>
              <h2
                className="mt-5 font-display font-bold text-[32px] sm:text-[40px] lg:text-[45px] leading-[1.15]"
                style={{ color: INK }}
              >
                &ldquo;Brighter Tomorrow Counseling Services&rdquo; was born
                from Yvette&rsquo;s{" "}
                <span style={{ color: WINE, fontStyle: "italic" }}>
                  personal journey.
                </span>
              </h2>
              <p className="mt-7 text-ink-muted text-[16px] leading-[1.8] max-w-2xl mx-auto">
                As she grappled with the anxiety of starting her own practice,
                she was reminded of each new day&rsquo;s promise. The name
                encapsulates the essence of new chances, potential, and the
                direction we&rsquo;re headed towards. The logo was crafted with
                the same sentiment. While we&rsquo;re open to evolving, our
                core belief remains the same: every individual deserves a
                brighter tomorrow.
              </p>
              <div className="mt-9 flex justify-center">
                <Link
                  href="/our-approach"
                  className="inline-flex items-center gap-2 font-display font-bold tracking-[0.15em] text-[13px] uppercase px-8 py-4 transition hover:opacity-90"
                  style={{
                    backgroundColor: GOLD,
                    color: INK,
                    borderRadius: "30px 0 30px 30px",
                  }}
                >
                  Learn About Our Approach <FiArrowUpRight />
                </Link>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* CTA banner — slate */}
      <section
        className="relative overflow-hidden"
        style={{ backgroundColor: "#6E7A8A" }}
      >
        <div
          aria-hidden
          className="absolute inset-0 opacity-30 bg-cover bg-center"
          style={{ backgroundImage: "url('/images/our-story/cta-bg.jpg')" }}
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
            <p className="mt-6 text-white/85 text-[16px] leading-relaxed max-w-2xl mx-auto">
              You don&rsquo;t have to face these challenges alone. Reach out to
              us today to learn more about how we can support you on your
              journey toward emotional well-being and a brighter tomorrow.
            </p>
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

      {/* OUR SPECIALTIES INCLUDE — team-with-dog image + check list */}
      <section className="bg-white py-20 lg:py-28">
        <div className="container-x grid lg:grid-cols-12 gap-12 lg:gap-16 items-center">
          <Reveal direction="left" className="lg:col-span-5">
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
                className="relative aspect-[3/4] overflow-hidden"
                style={{ borderRadius: "60px 0 60px 60px" }}
                whileHover={{ scale: 1.02 }}
                transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
              >
                <Image
                  src="/images/our-story/team-dog.jpg"
                  alt="Brighter Tomorrow team with therapy dog"
                  fill
                  sizes="(min-width:1024px) 460px, 100vw"
                  className="object-cover"
                />
              </motion.div>
            </div>
          </Reveal>
          <Reveal direction="right" delay={0.1} className="lg:col-span-7">
            <h2
              className="font-display font-bold text-[32px] sm:text-[40px] lg:text-[45px] leading-[1.15]"
              style={{ color: INK }}
            >
              Our Specialties{" "}
              <span style={{ color: WINE, fontStyle: "italic" }}>
                include
              </span>
            </h2>
            <ul className="mt-8 space-y-6">
              {SPECIALTIES_INCLUDE.map((it, i) => (
                <motion.li
                  key={it.title}
                  initial={{ opacity: 0, y: 16 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, amount: 0.3 }}
                  transition={{ duration: 0.5, delay: i * 0.07 }}
                  className="flex items-start gap-4"
                >
                  <span
                    className="mt-0.5 inline-grid place-items-center w-9 h-9 shrink-0 rounded-full"
                    style={{ border: `2px solid ${GOLD}`, color: GOLD }}
                  >
                    <FiCheckCircle size={18} strokeWidth={2} />
                  </span>
                  <div>
                    <h4
                      className="font-display font-bold text-[18px] sm:text-[20px] leading-[1.25]"
                      style={{ color: INK }}
                    >
                      {it.title}
                    </h4>
                    <p className="mt-2 text-ink-muted text-[15px] leading-[1.7]">
                      {it.body}
                    </p>
                  </div>
                </motion.li>
              ))}
            </ul>
            <p className="mt-8 text-ink-muted text-[16px] leading-[1.8]">
              At Brighter Tomorrow Therapy, we are committed to helping
              individuals face the emotional and mental health challenges that
              come with chronic illnesses, dialysis, chronic pain, grief, and
              life transitions. Our team of compassionate, experienced
              therapists provides evidence-based support tailored to your
              unique needs, ensuring that you have the tools to thrive despite
              life&rsquo;s challenges.
            </p>
          </Reveal>
        </div>
      </section>

      {/* OUR MISSION — wine band */}
      <section style={{ backgroundColor: WINE }} className="py-20 lg:py-24">
        <div className="container-narrow text-center">
          <Reveal direction="up">
            <h3 className="font-display font-bold text-[28px] sm:text-[34px] lg:text-[40px] text-white leading-[1.2]">
              Our{" "}
              <span style={{ color: GOLD, fontStyle: "italic" }}>Mission</span>
            </h3>
            <p className="mt-6 text-white/90 text-[16px] sm:text-[17px] leading-[1.8] max-w-3xl mx-auto">
              At Brighter Tomorrow Therapy, our mission is clear: to provide
              compassionate, evidence-based therapy that empowers individuals
              to build resilience, enhance their quality of life, and face
              challenges with confidence. Whether you&rsquo;re managing chronic
              pain, adjusting to life after a loss, or facing relationship
              struggles, we&rsquo;re here to walk with you every step of the
              way.
            </p>
          </Reveal>
        </div>
      </section>
    </article>
  );
}
