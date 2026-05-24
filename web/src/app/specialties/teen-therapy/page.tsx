"use client";

import Link from "next/link";
import Image from "next/image";
import { motion } from "framer-motion";
import Reveal from "@/components/Reveal";
import { FiCheckCircle, FiChevronRight } from "react-icons/fi";

const WINE = "#66202A";
const GOLD = "#E1B878";
const INK = "#192735";

const PRESSURE_QS = [
  "What if I'm not good enough?",
  "What if they don't like me?",
  "What if I fail?",
];

const PRESSURE_NOTICE = [
  "Compare yourself constantly",
  "Worry about what others think",
  "Feel uncomfortable in your own skin",
  "Change who you are depending on the group you're around",
  "Hide parts of yourself to avoid judgment",
];

const SUPPORT_AREAS = [
  "Anxiety",
  "Depression",
  "Trauma",
  "Low self-esteem",
  "Social comparison",
  "Body image concerns",
  "Academic stress",
  "Self-harming behaviors",
];

const PROGRESS_GOALS = [
  "Identify where certain fears or beliefs originated",
  "Understand emotional triggers",
  "Learn healthy coping strategies",
  "Strengthen self-compassion",
  "Develop assertiveness and boundary-setting skills",
  "Build resilience",
];

const MODALITIES = [
  "Cognitive Behavioral Therapy (CBT)",
  "Dialectical Behavior Therapy (DBT) skills",
  "Acceptance and Commitment Therapy (ACT)",
  "Mindfulness-based strategies",
  "Somatic techniques",
  "Strengths-based interventions",
  "Art-based expression",
];

const PARENT_SIGNS = [
  "Withdrawal or isolation",
  "Mood swings",
  "Declining academic performance",
  "Risky behaviors",
  "Self-harm",
  "Increased anxiety",
  "Changes in sleep or appetite",
];

const CONFIDENTIALITY = [
  { title: "There is a safety concern", body: "If your teen's safety is at risk, parents are informed promptly." },
  { title: "There is risk of harm", body: "Any imminent risk to your teen or others is escalated immediately." },
  { title: "The teen gives permission", body: "Your teen may invite parents into specific conversations." },
];

const SELF_TRUST = [
  "Feel more confident in their identity",
  "Regulate intense emotions",
  "Navigate friendships more intentionally",
  "Reduce self-critical thinking",
  "Make decisions aligned with their values",
  "Develop meaningful, healthy relationships",
  "Therapy helps teens shift from survival mode to growth mode.",
];

const FAQS = [
  {
    q: "Does my teen need a diagnosis to receive therapy?",
    a: "A diagnosis is only required when insurance is used. Our approach focuses on skill-building and emotional growth rather than labeling.",
  },
  {
    q: "Is wanting therapy a sign that something is wrong with me?",
    a: "Absolutely not. Seeking therapy shows insight and maturity. Learning coping tools early often strengthens long-term emotional health.",
  },
  {
    q: "Is today really harder than past generations?",
    a: "No. Today's teens face intense social and academic pressures. Social media exposure, comparison culture, and constant connectivity create challenges many adults did not experience growing up. Seeking therapy demonstrates care and proactive support.",
  },
  {
    q: "Will I know what my teen is talking about in therapy?",
    a: "We can provide general updates and collaborate with parents while maintaining appropriate confidentiality. If safety concerns arise, parents are notified immediately.",
  },
];

export default function TeenTherapyPage() {
  return (
    <article className="bg-white">
      {/* HERO */}
      <section className="relative overflow-hidden">
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{
            backgroundImage:
              "linear-gradient(rgba(15,22,30,0.55), rgba(15,22,30,0.55)), url('/images/specialties/teen-therapy/01-side-view-young-girl-talking-therapist.webp')",
          }}
          aria-hidden
        />
        <div className="relative container-x py-28 sm:py-36 lg:py-44 text-center">
          <Reveal>
            <h1
              className="font-display font-bold leading-tight text-[40px] sm:text-[52px] lg:text-[60px]"
              style={{ color: "#F4F4F4" }}
            >
              <span style={{ color: GOLD }}>Teen Counseling</span> in Las Vegas
            </h1>
            <p className="mt-6 font-display text-[18px] sm:text-[22px] text-white/90">
              Helping Teens Build Confidence, Resilience, and Self-Trust
            </p>
          </Reveal>
        </div>
      </section>

      {/* SECTION 2 — Feeling Overwhelmed */}
      <section className="bg-white">
        <div className="container-x py-20 lg:py-28">
          <div className="grid lg:grid-cols-12 gap-12 lg:gap-16 items-center">
            <Reveal className="lg:col-span-7">
              <h2
                className="font-display font-bold leading-[1.15] text-[30px] sm:text-[38px] lg:text-[42px]"
                style={{ color: INK }}
              >
                Feeling Overwhelmed, Self-Conscious, or Unsure of Who You Are?
              </h2>
              <p className="mt-6 text-[15px] sm:text-[16px] leading-[1.75] text-ink-soft">
                Being a teenager today is not easy. Between social media, academic pressure,
                friendships, family expectations, and figuring out who you are, it can feel like
                you&rsquo;re constantly being evaluated. You might be asking yourself:
              </p>
              <ul className="mt-5 space-y-2">
                {PRESSURE_QS.map((q, i) => (
                  <motion.li
                    key={q}
                    initial={{ opacity: 0, x: -16 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true, amount: 0.4 }}
                    transition={{ duration: 0.5, delay: i * 0.06 }}
                    className="flex items-start gap-3 text-[15px] text-ink-soft leading-[1.65]"
                  >
                    <FiChevronRight className="mt-1 shrink-0" size={18} style={{ color: WINE }} />
                    <span className="italic">{q}</span>
                  </motion.li>
                ))}
              </ul>
              <p className="mt-6 text-[15px] sm:text-[16px] leading-[1.75] text-ink-soft">
                It&rsquo;s exhausting to live inside that kind of pressure.
              </p>
              <p className="mt-5 text-[15px] sm:text-[16px] leading-[1.75] text-ink-soft">
                You may notice that you:
              </p>
              <ul className="mt-3 space-y-2">
                {PRESSURE_NOTICE.map((item, i) => (
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
              <p className="mt-6 text-[15px] sm:text-[16px] leading-[1.75] text-ink-soft">
                When your inner critic gets loud enough, it can start to feel like there&rsquo;s no
                escape.
              </p>
              <p className="mt-4 text-[15px] sm:text-[16px] leading-[1.75] text-ink-soft">
                And if the pain has led to self-harm, substance use, or thoughts of suicide, please
                know this clearly: You are not alone. And there is help.
              </p>
              <div className="mt-8">
                <Link
                  href="/contact"
                  className="inline-block font-display font-bold tracking-[0.15em] text-[13px] uppercase px-8 py-4 transition hover:opacity-90"
                  style={{ backgroundColor: GOLD, color: INK, borderRadius: "30px 0 30px 30px" }}
                >
                  Schedule An Appointment
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
                    src="/images/specialties/teen-therapy/01-side-view-young-girl-talking-therapist.webp"
                    alt="Teen in a therapy session"
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

      {/* A Space Where Teens Can Just Be Themselves (wine band card) */}
      <section style={{ backgroundColor: WINE }} className="relative">
        <div className="bg-cream pt-16 pb-20 px-4 sm:px-6 lg:px-10 mx-3 sm:mx-6 lg:mx-12 rounded-[40px] -my-10 relative z-10">
          <Reveal>
            <h3
              className="text-center font-display font-bold text-[28px] sm:text-[34px] lg:text-[37.5px] leading-[1.2]"
              style={{ color: INK }}
            >
              A Space Where Teens Can Just Be Themselves
            </h3>
            <p className="mt-5 max-w-3xl mx-auto text-center text-[15px] sm:text-[16px] leading-[1.75] text-ink-soft">
              Teen therapy offers something many adolescents don&rsquo;t often get — a private,
              neutral space where they can speak freely without fear of punishment, embarrassment,
              or peer pressure. At Brighter Tomorrow Therapy, we specialize in supporting teens
              navigating:
            </p>
          </Reveal>
          <ul className="mt-8 grid sm:grid-cols-2 lg:grid-cols-4 gap-x-8 gap-y-3 max-w-4xl mx-auto">
            {SUPPORT_AREAS.map((item, i) => (
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
          <p className="mt-8 max-w-3xl mx-auto text-center text-[15px] sm:text-[16px] leading-[1.75] text-ink-soft">
            Therapy is not about &ldquo;fixing&rdquo; you. It&rsquo;s about helping you understand
            yourself. When you learn how to regulate emotions, challenge distorted thoughts, and
            build confidence, you begin to feel more grounded — and more like yourself.
          </p>
        </div>
      </section>

      {/* What Teens Can Expect */}
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
                    src="/images/specialties/teen-therapy/02-pexels-tima-miroshnichenko-5336939.webp"
                    alt="Teen receiving counseling support"
                    fill
                    sizes="(min-width:1024px) 460px, 100vw"
                    className="object-cover"
                  />
                </motion.div>
              </div>
            </Reveal>

            <Reveal className="lg:col-span-7 order-1 lg:order-2">
              <h2
                className="font-display font-bold leading-[1.15] text-[30px] sm:text-[38px] lg:text-[42px]"
                style={{ color: INK }}
              >
                What Teens Can Expect in Therapy
              </h2>
              <p
                className="mt-6 font-display font-semibold text-[17px] sm:text-[19px] leading-[1.65]"
                style={{ color: WINE }}
              >
                Our personalized therapy approach provides an authentic journey toward a brighter
                future.
              </p>
              <p className="mt-5 text-[15px] sm:text-[16px] leading-[1.8] text-ink-soft">
                As therapy progresses, we help teens:
              </p>
              <ul className="mt-4 space-y-3">
                {PROGRESS_GOALS.map((item, i) => (
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
                Our approach is eclectic and tailored to developmental needs. Depending on the
                teen, we may incorporate:
              </p>
              <ul className="mt-4 space-y-3">
                {MODALITIES.map((item, i) => (
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
                Some teens need practical tools for anxiety management. Others need space to talk.
                We meet them where they are.
              </p>
            </Reveal>
          </div>
        </div>
      </section>

      {/* Teens Are Not Alone — wine band */}
      <section style={{ backgroundColor: WINE }} className="py-20 lg:py-24">
        <div className="container-x text-center">
          <Reveal>
            <p className="font-script italic text-[20px] sm:text-[22px]" style={{ color: GOLD }}>
              Take the first step
            </p>
            <h3 className="mt-3 font-display font-bold text-[28px] sm:text-[34px] lg:text-[37.5px] text-white leading-[1.2]">
              Teens Are Not Alone in Their Mental Health Struggles
            </h3>
            <p className="mt-6 max-w-3xl mx-auto text-white/90 text-[15px] sm:text-[16px] leading-[1.75]">
              Adolescence is a critical period of brain development. The emotional center of the
              brain matures faster than the parts responsible for long-term planning and impulse
              control. That imbalance can intensify stress, comparison, and emotional reactivity.
            </p>
            <p className="mt-4 max-w-3xl mx-auto text-white/90 text-[15px] sm:text-[16px] leading-[1.75]">
              Globally, mental health challenges among teens are increasing. Many adolescents
              struggle silently due to fear of judgment or stigma.
            </p>
            <p className="mt-4 max-w-3xl mx-auto text-white/90 text-[15px] sm:text-[16px] leading-[1.75]">
              One of the most powerful parts of therapy is helping teens understand:
            </p>
            <p className="mt-4 max-w-3xl mx-auto text-white text-[16px] sm:text-[17px] leading-[1.75] font-display font-semibold">
              This phase of pain is not permanent. It is treatable. And growth is POSSIBLE.
            </p>
          </Reveal>
        </div>
      </section>

      {/* For Parents */}
      <section className="bg-white py-20 lg:py-28">
        <div className="container-x">
          <div className="grid lg:grid-cols-12 gap-12 lg:gap-16 items-center">
            <Reveal className="lg:col-span-7">
              <h2
                className="font-display font-bold leading-[1.15] text-[30px] sm:text-[38px] lg:text-[42px]"
                style={{ color: INK }}
              >
                For Parents: When You&rsquo;re Worried About Your Teen
              </h2>
              <p className="mt-6 text-[15px] sm:text-[16px] leading-[1.75] text-ink-soft">
                Watching your child struggle can feel terrifying. You may be noticing:
              </p>
              <ul className="mt-4 space-y-3">
                {PARENT_SIGNS.map((item, i) => (
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
              <p className="mt-6 text-[15px] sm:text-[16px] leading-[1.75] text-ink-soft">
                You want to help. You&rsquo;ve probably tried talking, setting limits, offering
                advice. But sometimes your teen needs a space outside the family system to process
                what they&rsquo;re experiencing.
              </p>
              <p className="mt-4 text-[15px] sm:text-[16px] leading-[1.75] text-ink-soft">
                Teen counseling provides a safe, supportive environment where your child can
                explore their thoughts and emotions while developing healthy coping skills.
              </p>
              <p className="mt-4 text-[15px] sm:text-[16px] leading-[1.75] text-ink-soft">
                Seeking therapy for your teen is not a sign of failure. It is a sign of attentive
                parenting.
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
                    src="/images/specialties/teen-therapy/03-full-shot-tired-girl-sitting-desk.webp"
                    alt="Parent and teen navigating challenges"
                    fill
                    sizes="(min-width:1024px) 460px, 100vw"
                    className="object-cover"
                  />
                </motion.div>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* Our Approach — wine bg */}
      <section style={{ backgroundColor: WINE }} className="pt-20 lg:pt-28 pb-20">
        <div className="container-x">
          <div className="grid lg:grid-cols-12 gap-10 lg:gap-12">
            <Reveal className="lg:col-span-5">
              <h3 className="font-display font-bold text-[28px] sm:text-[34px] lg:text-[37.5px] text-white leading-[1.2]">
                Our Approach to Teen Counseling
              </h3>
              <p className="mt-5 text-white/85 leading-[1.7] text-[15px]">
                Trust is the foundation of effective teen therapy. We begin by building a
                therapeutic relationship that feels safe and respectful. Teens need to feel heard
                before they can open up.
              </p>
              <h4 className="mt-8 font-display font-bold text-[20px] sm:text-[22px] text-white">
                Confidentiality Matters
              </h4>
              <p className="mt-3 text-white/85 leading-[1.7] text-[15px]">
                We value parental involvement, especially during the intake process. However, for
                therapy to be effective, teens must feel secure in the privacy of their sessions.
                Information is only shared with parents if:
              </p>
            </Reveal>

            <div className="lg:col-span-7 grid gap-y-6 self-center">
              {CONFIDENTIALITY.map((it, i) => (
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
              <Reveal delay={0.3}>
                <p className="mt-2 text-white text-[15px] leading-[1.7]">
                  We aim to create collaboration, not secrecy.
                </p>
              </Reveal>
            </div>
          </div>
        </div>
      </section>

      {/* Building Self-Trust */}
      <section className="bg-cream-alt py-20 lg:py-28">
        <div className="container-x">
          <Reveal>
            <h3
              className="text-center font-display font-bold text-[28px] sm:text-[34px] lg:text-[37.5px] leading-[1.2]"
              style={{ color: INK }}
            >
              Building Self-Trust and Confidence
            </h3>
            <p className="mt-5 max-w-3xl mx-auto text-center text-[15px] sm:text-[16px] leading-[1.75] text-ink-soft">
              Many teens feel convinced that the stress and insecurity they&rsquo;re experiencing
              will last forever. It won&rsquo;t. With support, teens can learn to:
            </p>
          </Reveal>
          <ul className="mt-8 max-w-3xl mx-auto space-y-3">
            {SELF_TRUST.map((item, i) => (
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

      {/* FAQ */}
      <section className="bg-white py-20 lg:py-28">
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
                </details>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* CTA banner */}
      <section className="relative overflow-hidden" style={{ backgroundColor: "#6E7A8A" }}>
        <div className="container-x py-20 lg:py-24 text-center relative z-10">
          <Reveal>
            <p className="font-script italic text-[20px] sm:text-[24px]" style={{ color: GOLD }}>
              Let&rsquo;s Heal your Kids!
            </p>
            <h3 className="mt-3 font-display font-bold text-[32px] sm:text-[40px] lg:text-[45px] text-white leading-[1.15]">
              You Don&rsquo;t Have to Figure This Out{" "}
              <span style={{ color: GOLD }}>Alone</span>
            </h3>
            <p className="mt-5 max-w-3xl mx-auto text-white/90 text-[15px] sm:text-[16px] leading-[1.75]">
              Whether you are a teen feeling overwhelmed or a parent concerned about your
              child&rsquo;s well-being, we are here to help. At Brighter Tomorrow Therapy, we are
              committed to creating a safe, empowering space where teens can develop the confidence
              and emotional tools they need to thrive — not just now, but into adulthood.
            </p>
            <p className="mt-4 max-w-3xl mx-auto text-white/90 text-[15px] sm:text-[16px] leading-[1.75]">
              If you&rsquo;re ready to learn more about teen counseling in Las Vegas, we invite you
              to schedule a consultation.
            </p>
            <p className="mt-4 max-w-3xl mx-auto text-white text-[16px] sm:text-[18px] leading-[1.6] font-display font-semibold">
              Hope is real. Growth is possible. And support is available.
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
