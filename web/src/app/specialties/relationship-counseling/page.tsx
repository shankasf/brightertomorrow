"use client";

import Link from "next/link";
import Image from "next/image";
import { motion } from "framer-motion";
import Reveal from "@/components/Reveal";
import { FiCheckCircle, FiChevronRight } from "react-icons/fi";

const WINE = "#66202A";
const GOLD = "#E1B878";
const INK = "#192735";

const INDIVIDUAL_HELP = [
  "Identify recurring relational patterns",
  "Understand emotional triggers",
  "Strengthen communication skills",
  "Develop healthy boundaries",
  "Process past trauma",
  "Rebuild self-esteem and autonomy",
  "Learn to distinguish healthy love from harmful dynamics",
];

const SIGNS = [
  { title: "Feel consumed by relationship stress", body: "Your mind keeps replaying what was said, what wasn't, and what comes next." },
  { title: "Replay arguments or conversations repeatedly", body: "Old interactions occupy mental space long after they've ended." },
  { title: "Struggle to regulate your emotions during conflict", body: "Conflict triggers floods of overwhelm, shutdown, or escalation." },
  { title: "Have difficulty leaving unhealthy dynamics", body: "You sense the pattern, yet leaving feels impossibly hard." },
  { title: "Fear being alone yet fear closeness", body: "Both connection and solitude feel unsafe at the same time." },
  { title: "Question whether past abuse is affecting current relationships", body: "You wonder how much of today is shaped by yesterday." },
];

const GREW_UP = [
  "Emotional volatility",
  "Inconsistent caregiving",
  "Criticism or shame",
  "Silence or avoidance",
  "Abuse or control",
];

const PATTERN_RECOGNITION = [
  "They over-function or people-please",
  "They shut down when conflict arises",
  "They struggle to identify what healthy love looks like",
  "They tolerate harmful dynamics",
  "They feel responsible for others' emotions",
  "They fear abandonment",
];

const APPROACHES = [
  "Trauma-informed care",
  "EMDR (Eye Movement Desensitization and Reprocessing)",
  "Somatic-based interventions",
  "Acceptance and Commitment Therapy (ACT)",
  "Attachment-focused models",
  "Cognitive and behavioral strategies",
];

const NEW_PATTERNS = [
  "Respond instead of react",
  "Advocate for your needs",
  "Set boundaries without guilt",
  "Feel safe in vulnerability",
  "Choose partners and connections intentionally",
];

const ABUSE_FORMS = [
  "Emotional manipulation",
  "Gaslighting",
  "Isolation from friends or family",
  "Financial control",
  "Intimidation",
  "Threats",
  "Name-calling or degradation",
  "Refusal to take accountability",
];

const HEALTHY_CONNECTIONS = ["Safe", "Respectful", "Empowering", "Aligned with your values"];

const IPV_SYMPTOMS = [
  "Anxiety",
  "Depression",
  "Hypervigilance",
  "Post-traumatic stress",
  "Fear of vulnerability",
  "Difficulty forming secure attachments",
];

const FAQS = [
  {
    q: "Is couples therapy the right first step?",
    a: "While couples or family therapy can be helpful in many situations, it is not appropriate in cases involving abuse or coercive control. Couples therapy assumes a shared responsibility model. When there is a power imbalance or ongoing harm, individual therapy is often the safer and more effective first step. Our team includes therapists experienced in working with survivors of domestic violence and complex relational trauma.",
  },
  {
    q: "How does intimate partner violence affect mental health?",
    a: "Unhealthy dynamics can escalate into emotional, psychological, physical, or sexual abuse. Survivors of intimate partner violence often experience symptoms of anxiety, depression, hypervigilance, post-traumatic stress, fear of vulnerability, and difficulty forming secure attachments. Abuse is never your fault. And it is more common than many realize. National data shows that intimate partner violence affects millions of individuals across gender identities, particularly women and gender-diverse individuals. Therapy provides a safe, structured environment to unpack what happened — and to rebuild your sense of agency and self-trust.",
  },
];

export default function RelationshipCounselingPage() {
  return (
    <article className="bg-white">
      {/* HERO */}
      <section className="relative overflow-hidden">
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{
            backgroundImage:
              "linear-gradient(rgba(15,22,30,0.55), rgba(15,22,30,0.55)), url('/images/specialties/relationship-counseling/01-1_pexels-photo-6753172-scaled.jpg')",
          }}
          aria-hidden
        />
        <div className="relative container-x py-28 sm:py-36 lg:py-44 text-center">
          <Reveal>
            <h1
              className="font-display font-bold leading-tight text-[40px] sm:text-[52px] lg:text-[60px]"
              style={{ color: "#F4F4F4" }}
            >
              <span style={{ color: GOLD }}>Relationship Counseling</span> in Las Vegas
            </h1>
            <p className="mt-6 font-display text-[18px] sm:text-[22px] text-white/90">
              Break Unhealthy Patterns. Build Safe, Empowering Connections
            </p>
          </Reveal>
        </div>
      </section>

      {/* SECTION 2 — Drained intro */}
      <section className="bg-white">
        <div className="container-x py-20 lg:py-28">
          <div className="grid lg:grid-cols-12 gap-12 lg:gap-16 items-center">
            <Reveal className="lg:col-span-7">
              <h2
                className="font-display font-bold leading-[1.15] text-[30px] sm:text-[38px] lg:text-[42px]"
                style={{ color: INK }}
              >
                Are Your Relationships Leaving You Drained Instead of Fulfilled?
              </h2>
              <p className="mt-6 text-[15px] sm:text-[16px] leading-[1.75] text-ink-soft">
                Do you notice recurring conflict, emotional distance, or shutdown in your
                relationships? Do you struggle with trust — either in others or in yourself? Have
                you caught yourself repeating patterns you swore you would never carry into
                adulthood?
              </p>
              <p className="mt-5 text-[15px] sm:text-[16px] leading-[1.75] text-ink-soft">
                Relationships shape nearly every aspect of our emotional well-being. When they are
                supportive and secure, we feel energized, grounded, and resilient. When they are
                unstable, dismissive, or harmful, they can leave deep emotional scars.
              </p>
              <p className="mt-5 text-[15px] sm:text-[16px] leading-[1.75] text-ink-soft">
                You are not &ldquo;too sensitive.&rdquo; You are not &ldquo;bad at
                relationships.&rdquo; And you are not broken.
              </p>
              <p className="mt-5 text-[15px] sm:text-[16px] leading-[1.75] text-ink-soft">
                Often, we are simply repeating what was modeled to us.
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
                    src="/images/specialties/relationship-counseling/01-1_pexels-photo-6753172-scaled.jpg"
                    alt="Couple in counseling session"
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

      {/* Our Approach — wine bg */}
      <section style={{ backgroundColor: WINE }} className="py-20 lg:py-28">
        <div className="container-x">
          <Reveal>
            <h3 className="font-display font-bold text-[28px] sm:text-[34px] lg:text-[37.5px] text-white leading-[1.2]">
              Our Approach to Relationship Counseling
            </h3>
            <p className="mt-5 text-white/90 text-[15px] sm:text-[16px] leading-[1.75] max-w-3xl">
              At Brighter Tomorrow Therapy, we view mental health through a relational lens. Even
              in individual therapy, we explore how attachment, power dynamics, culture, and early
              experiences influence present-day interactions. Individual relationship counseling
              can help you:
            </p>
          </Reveal>
          <ul className="mt-8 grid sm:grid-cols-2 gap-x-10 gap-y-3 max-w-4xl">
            {INDIVIDUAL_HELP.map((item, i) => (
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
          <Reveal delay={0.2}>
            <p className="mt-8 text-white text-[15px] sm:text-[16px] leading-[1.75] max-w-3xl">
              You do not need a partner present to begin this work. Change can start with you.
            </p>
          </Reveal>
        </div>
      </section>

      {/* Signs You May Benefit (cream card on wine band) */}
      <section style={{ backgroundColor: WINE }} className="relative">
        <div className="bg-cream pt-16 pb-20 px-4 sm:px-6 lg:px-10 mx-3 sm:mx-6 lg:mx-12 rounded-[40px] -my-10 relative z-10">
          <Reveal>
            <h3
              className="text-center font-display font-bold text-[28px] sm:text-[34px] lg:text-[37.5px] leading-[1.2]"
              style={{ color: INK }}
            >
              Signs You May Benefit from Relationship Counseling
            </h3>
            <p className="mt-5 max-w-3xl mx-auto text-center text-[15px] sm:text-[16px] leading-[1.75] text-ink-soft">
              You might consider therapy if you:
            </p>
          </Reveal>

          <div className="mt-12 grid sm:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-7">
            {SIGNS.map(({ title, body }, i) => (
              <Reveal key={title} delay={i * 0.06}>
                <motion.div
                  whileHover={{ y: -6 }}
                  transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                  className="h-full bg-white p-6 text-left"
                  style={{
                    borderRadius: "30px 0 30px 30px",
                    border: `1px solid ${i === 0 ? WINE : GOLD}`,
                  }}
                >
                  <h4
                    className="font-display font-bold text-[17px] sm:text-[19px] leading-[1.3]"
                    style={{ color: INK }}
                  >
                    {title}
                  </h4>
                  <p className="mt-3 text-[14.5px] leading-[1.65] text-ink-soft">{body}</p>
                </motion.div>
              </Reveal>
            ))}
          </div>

          <Reveal delay={0.3}>
            <p className="mt-10 max-w-3xl mx-auto text-center text-[15px] sm:text-[16px] leading-[1.75] text-ink-soft">
              Therapy is not only for crisis. It is for clarity, growth, and intentional change.
            </p>
          </Reveal>
        </div>
      </section>

      {/* Early Experiences */}
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
                    src="/images/specialties/relationship-counseling/02-danny-lines-UdAGG1_vdEE-unsplash.webp"
                    alt="Reflective moment about relationships"
                    fill
                    sizes="(min-width:1024px) 460px, 100vw"
                    className="object-cover"
                  />
                </motion.div>
              </div>
            </Reveal>

            <Reveal className="lg:col-span-7 order-1 lg:order-2">
              <p
                className="font-script italic text-[20px] sm:text-[22px]"
                style={{ color: WINE }}
              >
                About Brighter Tomorrow Counseling
              </p>
              <h3
                className="mt-3 font-display font-bold leading-[1.15] text-[28px] sm:text-[34px] lg:text-[40px]"
                style={{ color: INK }}
              >
                How Early Experiences Shape Adult Relationships
              </h3>
              <p className="mt-6 text-[15px] sm:text-[16px] leading-[1.8] text-ink-soft">
                The way we learned love, safety, conflict, and intimacy as children becomes the
                blueprint for how we show up as adults. If you grew up around:
              </p>
              <ul className="mt-4 space-y-2">
                {GREW_UP.map((item, i) => (
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
                …it makes sense that trust, vulnerability, or boundary-setting might feel
                complicated today. Many adults come to therapy recognizing:
              </p>
              <ul className="mt-4 space-y-2">
                {PATTERN_RECOGNITION.map((item, i) => (
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
              <p
                className="mt-6 font-display italic text-[18px] sm:text-[20px] leading-[1.6]"
                style={{ color: WINE }}
              >
                &ldquo;Relational wounds often occur within connection — and healing also happens
                within connection.&rdquo;
              </p>
            </Reveal>
          </div>
        </div>
      </section>

      {/* What to Expect — wine bg */}
      <section style={{ backgroundColor: WINE }} className="py-20 lg:py-28">
        <div className="container-x">
          <Reveal>
            <h3 className="font-display font-bold text-[28px] sm:text-[34px] lg:text-[37.5px] text-white leading-[1.2]">
              What to Expect in Therapy
            </h3>
            <p
              className="mt-4 font-display italic text-[18px] sm:text-[20px]"
              style={{ color: GOLD }}
            >
              Our personalized therapy approach provides an authentic journey toward a brighter
              future.
            </p>
            <p className="mt-6 text-white/90 text-[15px] sm:text-[16px] leading-[1.75] max-w-3xl">
              Relationship counseling is not about blaming yourself or your past. It is about
              increasing awareness and choice. Your therapist may incorporate approaches such as:
            </p>
          </Reveal>

          <div className="mt-8 grid lg:grid-cols-12 gap-10">
            <div className="lg:col-span-6">
              <ul className="space-y-3">
                {APPROACHES.map((item, i) => (
                  <Reveal key={item} delay={i * 0.05}>
                    <div className="flex items-start gap-4">
                      <span
                        className="mt-0.5 inline-grid place-items-center w-9 h-9 shrink-0 rounded-full"
                        style={{ border: `2px solid ${GOLD}`, color: GOLD }}
                      >
                        <FiCheckCircle size={20} strokeWidth={2} />
                      </span>
                      <span className="text-white text-[15px] sm:text-[16px] leading-[1.65] pt-1">
                        {item}
                      </span>
                    </div>
                  </Reveal>
                ))}
              </ul>
            </div>
            <div className="lg:col-span-6">
              <Reveal>
                <p className="text-white/90 text-[15px] sm:text-[16px] leading-[1.75]">
                  Together, we will explore how your nervous system responds in relationships,
                  where certain beliefs originated, and how to build new patterns that align with
                  your values. Over time, you can learn to:
                </p>
              </Reveal>
              <ul className="mt-4 space-y-2">
                {NEW_PATTERNS.map((item, i) => (
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
            </div>
          </div>
        </div>
      </section>

      {/* Understanding Abuse and Control */}
      <section className="bg-cream-alt py-20 lg:py-28">
        <div className="container-x">
          <Reveal>
            <h3
              className="text-center font-display font-bold text-[28px] sm:text-[34px] lg:text-[37.5px] leading-[1.2]"
              style={{ color: INK }}
            >
              Understanding Abuse and Control
            </h3>
            <p className="mt-5 max-w-3xl mx-auto text-center text-[15px] sm:text-[16px] leading-[1.75] text-ink-soft">
              Abuse is not limited to physical violence. It can include:
            </p>
          </Reveal>

          <ul className="mt-10 max-w-3xl mx-auto grid sm:grid-cols-2 gap-x-10 gap-y-3">
            {ABUSE_FORMS.map((item, i) => (
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

          <Reveal delay={0.2}>
            <p className="mt-8 max-w-3xl mx-auto text-center text-[15px] sm:text-[16px] leading-[1.75] text-ink-soft">
              Abuse can occur in romantic relationships, families, friendships, or other close
              connections. If you are in immediate danger, please contact emergency services or the
              National Domestic Violence Hotline at{" "}
              <a
                href="tel:18007997233"
                className="font-display font-semibold underline underline-offset-2"
                style={{ color: WINE }}
              >
                800-799-SAFE (7233)
              </a>
              . You deserve safety.
            </p>
          </Reveal>
        </div>
      </section>

      {/* You Don't Have to Navigate Alone */}
      <section className="bg-white py-20 lg:py-28">
        <div className="container-x grid lg:grid-cols-12 gap-12 lg:gap-16 items-center">
          <Reveal className="lg:col-span-7">
            <h3
              className="font-display font-bold leading-[1.15] text-[28px] sm:text-[34px] lg:text-[40px]"
              style={{ color: INK }}
            >
              You Don&rsquo;t Have to Navigate This Alone
            </h3>
            <p className="mt-6 text-[15px] sm:text-[16px] leading-[1.8] text-ink-soft">
              If you are ready to examine your relationship patterns, process relational trauma, or
              build stronger emotional boundaries, we are here to support you. At Brighter Tomorrow
              Therapy, our goal is to help you create connections that feel:
            </p>
            <ul className="mt-5 grid grid-cols-2 gap-y-3 gap-x-6 max-w-md">
              {HEALTHY_CONNECTIONS.map((item, i) => (
                <motion.li
                  key={item}
                  initial={{ opacity: 0, x: -16 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true, amount: 0.4 }}
                  transition={{ duration: 0.5, delay: i * 0.05 }}
                  className="flex items-start gap-3 text-[15px] text-ink-soft leading-[1.65]"
                >
                  <FiCheckCircle className="mt-1 shrink-0" size={18} style={{ color: WINE }} />
                  <span>{item}</span>
                </motion.li>
              ))}
            </ul>
            <p className="mt-6 text-[15px] sm:text-[16px] leading-[1.8] text-ink-soft">
              You deserve relationships that nourish you — not deplete you.
            </p>
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
                  src="/images/specialties/relationship-counseling/09-aliya-sam-IY1qjGeniV8-unsplash.webp"
                  alt="Healthy supportive relationship"
                  fill
                  sizes="(min-width:1024px) 460px, 100vw"
                  className="object-cover"
                />
              </motion.div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* FAQ */}
      <section className="bg-cream-alt py-20 lg:py-28">
        <div className="container-x max-w-4xl">
          <Reveal>
            <h3
              className="text-center font-display font-bold text-[28px] sm:text-[34px] lg:text-[37.5px] leading-[1.2]"
              style={{ color: INK }}
            >
              Frequently Asked Questions
            </h3>
          </Reveal>

          <div className="mt-12 space-y-6">
            {FAQS.map((faq, i) => (
              <Reveal key={faq.q} delay={i * 0.05}>
                <details
                  className="group bg-white p-6 cursor-pointer"
                  style={{ borderRadius: "30px 0 30px 30px", border: `1px solid ${GOLD}` }}
                >
                  <summary
                    className="list-none flex items-start justify-between gap-4 font-display font-bold text-[18px] sm:text-[19px]"
                    style={{ color: INK }}
                  >
                    <span>{faq.q}</span>
                    <span
                      className="shrink-0 mt-1 transition-transform group-open:rotate-45"
                      style={{ color: WINE }}
                      aria-hidden
                    >
                      +
                    </span>
                  </summary>
                  <p className="mt-4 text-[15px] leading-[1.75] text-ink-soft">{faq.a}</p>
                  {faq.q.includes("intimate partner violence") && (
                    <ul className="mt-3 space-y-2">
                      {IPV_SYMPTOMS.map((s) => (
                        <li
                          key={s}
                          className="flex items-start gap-2 text-[14.5px] leading-[1.7] text-ink-soft"
                        >
                          <FiChevronRight
                            className="mt-1 shrink-0"
                            size={16}
                            style={{ color: WINE }}
                          />
                          <span>{s}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </details>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* CTA banner — Healing Is Possible */}
      <section className="relative overflow-hidden" style={{ backgroundColor: "#6E7A8A" }}>
        <div className="container-x py-20 lg:py-24 text-center relative z-10">
          <Reveal>
            <p className="font-script italic text-[20px] sm:text-[24px]" style={{ color: GOLD }}>
              Let&rsquo;s Heal You!
            </p>
            <h3 className="mt-3 font-display font-bold text-[32px] sm:text-[40px] lg:text-[45px] text-white leading-[1.15]">
              <span style={{ color: GOLD }}>Healing</span> Is Possible
            </h3>
            <p className="mt-5 max-w-3xl mx-auto text-white/90 text-[15px] sm:text-[16px] leading-[1.75]">
              Many clients begin therapy feeling ashamed of &ldquo;allowing&rdquo; certain dynamics
              or unsure whether their experiences &ldquo;count&rdquo; as trauma. Healing begins when
              we replace shame with understanding. When you learn how your nervous system adapted
              to survive earlier environments, your patterns make sense. And once they make sense,
              they can change.
            </p>
            <p className="mt-4 max-w-3xl mx-auto text-white text-[16px] sm:text-[18px] leading-[1.6] font-display font-semibold">
              Healthy relationships are not built on fear. They are built on safety, mutual
              respect, and emotional responsibility.
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
