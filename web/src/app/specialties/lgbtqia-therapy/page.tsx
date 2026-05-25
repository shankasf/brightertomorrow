"use client";

import Link from "next/link";
import Image from "next/image";
import { motion } from "framer-motion";
import Reveal from "@/components/Reveal";
import { FiCheckCircle, FiChevronRight } from "react-icons/fi";

const WINE = "#66202A";
const GOLD = "#E1B878";
const INK = "#192735";

const THERAPY_BUILDS = [
  "Emotional regulation skills",
  "Healthy communication and boundary-setting",
  "Self-advocacy",
  "Strength-based identity development",
  "Coping tools for stress and discrimination",
  "Rebuilding self-esteem and resilience",
  "You deserve a life where you are thriving — not shrinking",
];

const EMOTIONAL_WEIGHT = [
  "Anxiety around safety or acceptance",
  "Internalized shame or self-doubt",
  "Relationship strain",
  "Difficulty feeling emotionally secure",
  "Trauma related to discrimination or harassment",
  "Challenges with depression, substance use, eating concerns, or self-harm",
];

const LIFESPAN = [
  "Children and adolescents",
  "Adults",
  "Couples and partners",
  "Families",
  "Allies and caregivers",
];

const THERAPIST_INTENT = [
  { title: "Invite feedback", body: "Welcoming honest input so the work continues to fit your evolving needs." },
  { title: "Create emotionally safe environments", body: "Holding space that feels secure, private, and free of judgment." },
  { title: "Engage in ongoing education around cultural competence", body: "Staying current on the lived realities of LGBTQIA+ communities." },
  { title: "Examine and address bias", body: "Doing the internal work so it does not show up in the room with you." },
  { title: "Validate lived experiences without defensiveness", body: "Receiving what you share with openness, not deflection." },
];

const APPROACH = [
  { title: "Cultural humility", body: "We meet you with curiosity, not assumption." },
  { title: "Compassionate curiosity", body: "Your story leads the work — we ask, listen, and learn." },
  { title: "Trauma-informed care", body: "Grounded in safety, choice, and your nervous system's pacing." },
  { title: "Identity affirmation", body: "Honoring the full spectrum of who you are." },
  { title: "Emotional safety", body: "A room where your truth is protected and respected." },
];

const TAILORED_FOR = [
  "Exploring your sexual orientation or gender identity",
  "Navigating the coming-out process",
  "Healing from rejection or religious trauma",
  "Working through relationship challenges",
  "Seeking support as a parent or ally",
];

export default function LgbtqiaTherapyPage() {
  return (
    <article className="bg-white">
      {/* HERO */}
      <section className="relative overflow-hidden">
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{
            backgroundImage:
              "linear-gradient(rgba(15,22,30,0.55), rgba(15,22,30,0.55)), url('/images/specialties/lgbtqia-therapy/00-hero-Brighter-Tomorrow-teletherapy.webp')",
          }}
          aria-hidden
        />
        <div className="relative container-x py-28 sm:py-36 lg:py-44 text-center">
          <Reveal>
            <h1
              className="font-display font-bold leading-tight text-[40px] sm:text-[52px] lg:text-[60px]"
              style={{ color: "#F4F4F4" }}
            >
              <span style={{ color: GOLD }}>LGBTQIA+ Affirming Therapy</span> in Las Vegas, NV
            </h1>
            <p className="mt-6 font-display text-[18px] sm:text-[22px] text-white/90">
              A Space Where You Are Fully Seen, Respected, and Valued
            </p>
          </Reveal>
        </div>
      </section>

      {/* SECTION — Are You Longing + image */}
      <section className="bg-white">
        <div className="container-x py-20 lg:py-28">
          <div className="grid lg:grid-cols-12 gap-12 lg:gap-16 items-center">
            <Reveal className="lg:col-span-7">
              <h2
                className="font-display font-bold leading-[1.15] text-[32px] sm:text-[40px] lg:text-[45px]"
                style={{ color: INK }}
              >
                Are You Longing to Feel Safe and Affirmed in Who You Are?
              </h2>
              <p className="mt-6 text-[15px] sm:text-[16px] leading-[1.75] text-ink-soft">
                If you identify as LGBTQIA+ and struggle with feeling accepted, understood, or
                celebrated for your identity, you are not alone.
              </p>
              <p className="mt-5 text-[15px] sm:text-[16px] leading-[1.75] text-ink-soft">
                If you are a parent, partner, family member, or ally wanting to better support
                someone you love, we are here for you, too.
              </p>
              <p className="mt-5 text-[15px] sm:text-[16px] leading-[1.75] text-ink-soft">
                Living authentically should not feel like a battle — yet for many in the LGBTQIA+
                community, it often does.
              </p>
              <div className="mt-8">
                <Link
                  href="/contact"
                  className="inline-block font-display font-bold tracking-[0.15em] text-[13px] uppercase px-8 py-4 transition hover:opacity-90"
                  style={{ backgroundColor: GOLD, color: INK, borderRadius: "30px 0 30px 30px" }}
                >
                  Schedule My Appointment
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
                    src="/images/specialties/lgbtqia-therapy/02-charlesdeluvio-rRWiVQzLm7k-unsplash.webp"
                    alt="LGBTQIA+ affirming therapy in Las Vegas"
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

      {/* What Therapy Can Help You Build (wine list card) */}
      <section style={{ backgroundColor: WINE }} className="relative">
        <div className="bg-cream pt-16 pb-20 px-4 sm:px-6 lg:px-10 mx-3 sm:mx-6 lg:mx-12 rounded-[40px] -my-10 relative z-10">
          <Reveal>
            <h3
              className="text-center font-display font-bold text-[28px] sm:text-[34px] lg:text-[37.5px]"
              style={{ color: INK }}
            >
              What Therapy Can Help You Build
            </h3>
            <p className="mt-5 max-w-3xl mx-auto text-center text-[15px] sm:text-[16px] leading-[1.75] text-ink-soft">
              Affirming therapy goes beyond validation. It equips you with lifelong tools to
              strengthen your emotional, relational, and psychological well-being. Together, we
              may focus on:
            </p>
          </Reveal>
          <ul className="mt-10 grid sm:grid-cols-2 gap-x-10 gap-y-4 max-w-4xl mx-auto">
            {THERAPY_BUILDS.map((item, i) => (
              <motion.li
                key={item}
                initial={{ opacity: 0, x: -16 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true, amount: 0.4 }}
                transition={{ duration: 0.5, delay: i * 0.05 }}
                className="flex items-start gap-3 text-[15px] text-ink-soft leading-[1.65]"
              >
                <FiChevronRight className="mt-1 shrink-0" size={18} style={{ color: WINE }} />
                <span>{item}</span>
              </motion.li>
            ))}
          </ul>
        </div>
      </section>

      {/* Emotional weight + image */}
      <section className="bg-white pt-28 pb-20 lg:pb-28">
        <div className="container-x">
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
                    src="/images/specialties/lgbtqia-therapy/03-anthony-tran-i-ePv9Dxg7U-unsplash.webp"
                    alt="Person in reflective moment"
                    fill
                    sizes="(min-width:1024px) 460px, 100vw"
                    className="object-cover"
                  />
                </motion.div>
              </div>
            </Reveal>

            <Reveal className="lg:col-span-7 order-1 lg:order-2">
              <h3
                className="font-display font-bold leading-[1.15] text-[28px] sm:text-[34px] lg:text-[40px]"
                style={{ color: INK }}
              >
                The Emotional Weight of Navigating Identity in an Uncertain World
              </h3>
              <p className="mt-6 text-[15px] sm:text-[16px] leading-[1.8] text-ink-soft">
                We live in a culture that frequently centers heteronormative expectations. For
                LGBTQIA+ individuals, that reality can create layers of pressure, fear, and
                isolation. Add family dynamics, cultural expectations, or community rejection into
                the mix, and the emotional toll can feel overwhelming. Many people in the LGBTQIA+
                community experience:
              </p>
              <ul className="mt-6 space-y-3">
                {EMOTIONAL_WEIGHT.map((item, i) => (
                  <motion.li
                    key={item}
                    initial={{ opacity: 0, x: -16 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true, amount: 0.4 }}
                    transition={{ duration: 0.5, delay: i * 0.05 }}
                    className="flex items-start gap-3 text-[15px] text-ink-soft leading-[1.65]"
                  >
                    <FiChevronRight className="mt-1 shrink-0" size={18} style={{ color: WINE }} />
                    <span>{item}</span>
                  </motion.li>
                ))}
              </ul>
              <p className="mt-6 text-[15px] sm:text-[16px] leading-[1.8] text-ink-soft">
                When you&rsquo;ve had to protect yourself by hiding parts of who you are, it can
                create a painful disconnect within. Over time, that fracture may affect your mental
                health, relationships, and sense of identity. You deserve better than surviving in
                silence.
              </p>
            </Reveal>
          </div>
        </div>
      </section>

      {/* Disparities + Inclusive Care */}
      <section className="bg-cream-alt py-20 lg:py-28">
        <div className="container-x grid lg:grid-cols-2 gap-12 lg:gap-16">
          <Reveal>
            <h3
              className="font-display font-bold leading-[1.15] text-[26px] sm:text-[32px]"
              style={{ color: INK }}
            >
              The Reality of Discrimination and Mental Health Disparities
            </h3>
            <p className="mt-5 text-[15px] leading-[1.8] text-ink-soft">
              Across the country, LGBTQIA+ individuals continue to face systemic barriers, harmful
              rhetoric, and reduced access to affirming healthcare. Youth, in particular, experience
              heightened vulnerability.
            </p>
            <p className="mt-4 text-[15px] leading-[1.8] text-ink-soft">
              Research consistently shows that LGBTQIA+ individuals face elevated rates of
              depression, anxiety, suicidal ideation, and healthcare discrimination. These
              disparities are not a reflection of identity — they are a reflection of the
              environments many people are forced to navigate.
            </p>
            <p className="mt-4 text-[15px] leading-[1.8] text-ink-soft">
              Therapy can become a protective, stabilizing force — a place where your identity is
              not questioned, minimized, or debated. It is honored.
            </p>
          </Reveal>

          <Reveal delay={0.1}>
            <h3
              className="font-display font-bold leading-[1.15] text-[26px] sm:text-[32px]"
              style={{ color: INK }}
            >
              Inclusive Care Across the Lifespan
            </h3>
            <p className="mt-5 text-[15px] leading-[1.8] text-ink-soft">
              We provide LGBTQIA+ affirming therapy for:
            </p>
            <ul className="mt-4 space-y-3">
              {LIFESPAN.map((item, i) => (
                <motion.li
                  key={item}
                  initial={{ opacity: 0, x: -16 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true, amount: 0.4 }}
                  transition={{ duration: 0.5, delay: i * 0.05 }}
                  className="flex items-start gap-3 text-[15px] text-ink-soft leading-[1.65]"
                >
                  <FiChevronRight className="mt-1 shrink-0" size={18} style={{ color: WINE }} />
                  <span>{item}</span>
                </motion.li>
              ))}
            </ul>
            <p className="mt-5 text-[15px] leading-[1.8] text-ink-soft">
              For minors, we center the child&rsquo;s voice while thoughtfully involving parents or
              guardians in a supportive, educational role.
            </p>
            <p className="mt-4 text-[15px] leading-[1.8] text-ink-soft">
              As a neuro-affirming practice, we also support LGBTQIA+ individuals who are autistic
              or have ADHD, recognizing the unique intersectionality of identity and
              neurodivergence.
            </p>
          </Reveal>
        </div>
      </section>

      {/* If You've Been Hurt Before */}
      <section className="bg-white py-20 lg:py-28">
        <div className="container-x">
          <Reveal>
            <h3
              className="font-display font-bold text-center text-[28px] sm:text-[34px] lg:text-[37.5px] leading-[1.2]"
              style={{ color: INK }}
            >
              If You&rsquo;ve Been Hurt by Healthcare Before
            </h3>
            <p className="mt-5 max-w-3xl mx-auto text-center text-[15px] sm:text-[16px] leading-[1.75] text-ink-soft">
              You may be wondering: &ldquo;How will this be different?&rdquo; We understand that
              previous negative experiences with providers can make reaching out feel vulnerable.
              Our therapists work intentionally to:
            </p>
          </Reveal>

          <div className="mt-12 grid sm:grid-cols-2 lg:grid-cols-5 gap-6">
            {THERAPIST_INTENT.map((it, i) => (
              <Reveal key={it.title} delay={i * 0.06}>
                <motion.div
                  whileHover={{ y: -6 }}
                  transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                  className="h-full bg-white p-6 text-center"
                  style={{
                    borderRadius: "30px 0 30px 30px",
                    border: `1px solid ${i === 0 ? WINE : GOLD}`,
                  }}
                >
                  <h4
                    className="font-display font-bold text-[16px] leading-[1.3]"
                    style={{ color: INK }}
                  >
                    {it.title}
                  </h4>
                  <p className="mt-3 text-[14px] leading-[1.6] text-ink-soft">{it.body}</p>
                </motion.div>
              </Reveal>
            ))}
          </div>

          <Reveal delay={0.2}>
            <p className="mt-10 max-w-3xl mx-auto text-center text-[15px] leading-[1.75] text-ink-soft">
              Whether your therapist personally identifies as LGBTQIA+ or not, what matters most is
              that you feel respected, heard, and empowered in the room. We approach this work with
              humility and commitment — not assumptions.
            </p>
          </Reveal>
        </div>
      </section>

      {/* Our Approach — wine bg */}
      <section style={{ backgroundColor: WINE }} className="pt-20 lg:pt-28 pb-20">
        <div className="container-x">
          <div className="grid lg:grid-cols-12 gap-10 lg:gap-12">
            <Reveal className="lg:col-span-4">
              <h3 className="font-display font-bold text-[28px] sm:text-[34px] lg:text-[37.5px] text-white leading-[1.2]">
                Our Approach to LGBTQIA+ Affirming Therapy
              </h3>
              <p className="mt-5 text-white/85 leading-[1.7] text-[15px]">
                At Brighter Tomorrow Therapy, we are committed to creating a counselling space
                rooted in:
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
            <div className="mt-12">
              <p className="text-white text-[16px] leading-[1.75] max-w-3xl">
                Whether you are:
              </p>
              <ul className="mt-4 space-y-2">
                {TAILORED_FOR.map((item, i) => (
                  <motion.li
                    key={item}
                    initial={{ opacity: 0, x: -16 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true, amount: 0.4 }}
                    transition={{ duration: 0.5, delay: i * 0.05 }}
                    className="flex items-start gap-3 text-[15px] text-white/90 leading-[1.65]"
                  >
                    <FiChevronRight className="mt-1 shrink-0" size={18} style={{ color: GOLD }} />
                    <span>{item}</span>
                  </motion.li>
                ))}
              </ul>
              <p className="mt-6 text-white text-[16px] leading-[1.75] max-w-3xl">
                We tailor therapy to your unique experience. Our goal is not to define you — it is
                to support you in defining yourself.
              </p>
            </div>
            <div className="mt-10 flex justify-end">
              <Link
                href="/contact"
                className="inline-block font-display font-bold tracking-[0.15em] text-[13px] uppercase px-8 py-4 transition hover:opacity-90"
                style={{ backgroundColor: GOLD, color: INK, borderRadius: "30px 0 30px 30px" }}
              >
                Schedule My Appointment
              </Link>
            </div>
          </Reveal>
        </div>
      </section>

      {/* Brighter Tomorrow Counseling — Pace + Commitment */}
      <section className="bg-cream-alt py-20 lg:py-28">
        <div className="container-x">
          <Reveal>
            <h3
              className="text-center font-display font-bold text-[28px] sm:text-[34px] lg:text-[37.5px] leading-[1.2]"
              style={{ color: INK }}
            >
              Brighter Tomorrow Counseling
            </h3>
          </Reveal>

          <div className="mt-12 grid lg:grid-cols-12 gap-12 items-center">
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
                    src="/images/specialties/lgbtqia-therapy/04-seljan-salimova-M08sYIYTZ2w-unsplash.webp"
                    alt="Affirming therapy environment"
                    fill
                    sizes="(min-width:1024px) 460px, 100vw"
                    className="object-cover"
                  />
                </motion.div>
              </div>
            </Reveal>

            <div className="lg:col-span-7 space-y-8">
              <Reveal>
                <h4
                  className="font-display font-bold text-[22px] sm:text-[26px] leading-[1.25]"
                  style={{ color: INK }}
                >
                  You Set the Pace
                </h4>
                <p className="mt-4 text-[15px] leading-[1.8] text-ink-soft">
                  If you&rsquo;re not ready to unpack trauma or painful experiences, that&rsquo;s
                  okay.
                </p>
                <p className="mt-3 text-[15px] leading-[1.8] text-ink-soft">
                  Therapy is your process. We will never force conversations you&rsquo;re not
                  prepared to have. Healing happens at your speed, not ours.
                </p>
              </Reveal>
              <Reveal delay={0.08}>
                <h4
                  className="font-display font-bold text-[22px] sm:text-[26px] leading-[1.25]"
                  style={{ color: INK }}
                >
                  Our Commitment
                </h4>
                <p className="mt-4 text-[15px] leading-[1.8] text-ink-soft">
                  We always advocate for the support and affirmation of the LGBTQIA+ community.
                </p>
                <p className="mt-3 text-[15px] leading-[1.8] text-ink-soft">
                  Our mission is to advocate for, support, and affirm the LGBTQIA+ community by
                  honoring the full spectrum of gender identity and sexual expression. We believe
                  authenticity is not something to earn — it is something to protect and nurture.
                </p>
              </Reveal>
            </div>
          </div>
        </div>
      </section>

      {/* CTA banner */}
      <section className="relative overflow-hidden" style={{ backgroundColor: "#6E7A8A" }}>
        <div className="container-x py-20 lg:py-24 text-center relative z-10">
          <Reveal>
            <p className="font-script italic text-[20px] sm:text-[24px]" style={{ color: GOLD }}>
              Ready to Take the Next Step?
            </p>
            <h3 className="mt-3 font-display font-bold text-[32px] sm:text-[40px] lg:text-[45px] text-white leading-[1.15]">
              Schedule Your <span style={{ color: GOLD }}>LGBTQIA+ Affirming Therapy</span> Session
            </h3>
            <p className="mt-5 max-w-2xl mx-auto text-white/90 text-[15px] sm:text-[16px] leading-[1.75]">
              You deserve support that feels safe, affirming, and empowering. If you&rsquo;re ready
              to begin your journey — or even if you&rsquo;re just curious about what that might
              look like — we invite you to reach out for a consultation. Let&rsquo;s build a
              brighter tomorrow where you can live openly, confidently, and fully as yourself.
            </p>
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
