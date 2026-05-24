"use client";

import Link from "next/link";
import Image from "next/image";
import { motion } from "framer-motion";
import Reveal from "@/components/Reveal";
import {
  FiCheckCircle,
  FiChevronRight,
  FiCloudOff,
  FiShield,
  FiUsers,
  FiHeart,
} from "react-icons/fi";

const WINE = "#66202A";
const GOLD = "#E1B878";
const INK = "#192735";

const BENEFITS = [
  {
    Icon: FiCloudOff,
    title: "Reduce Stress and Anxiety During Uncertain Times",
    body: "Transitions bring uncertainty, and uncertainty often leads to stress and anxiety. A therapist helps you understand how your mind and body react to stress, teaching you strategies to manage stress and anxiety more effectively.",
  },
  {
    Icon: FiShield,
    title: "Develop Coping Skills for Long-Term Resilience",
    body: "Every type of transition requires coping skills to adjust and thrive. Life transition counseling helps you develop effective coping mechanisms tailored to your personal experiences.",
  },
  {
    Icon: FiUsers,
    title: "Improve Your Relationships and Communication",
    body: "Major life transitions, whether personal or professional, can put a strain on your relationships. Therapy helps you understand the impact of these changes and gives you tools to communicate more effectively with loved ones, colleagues, or friends.",
  },
  {
    Icon: FiHeart,
    title: "Support for Emotionally Taxing Life Changes",
    body: "Some life events are deeply emotional, such as losing a loved one, ending a relationship, or facing a major health diagnosis. Counseling provides a compassionate space to work through grief, sadness, or fear, allowing you to heal at your own pace.",
  },
];

const APPROACH = [
  {
    title: "Tailored Therapy for Your Unique Journey",
    body: "No two life transitions are the same. That's why our life transition therapy is designed to help individuals address the specific challenges they're facing.",
  },
  {
    title: "A Deep Dive into What's Holding You Back",
    body: "Our life transition therapists help you uncover the root causes of your challenges, ensuring meaningful, lasting change.",
  },
  {
    title: "Continuous Collaboration and Expert Guidance",
    body: "We believe in a collaborative approach, where we work alongside you, incorporating your feedback to ensure that therapy evolves in sync with your personal growth.",
  },
  {
    title: "Holistic Healing for a Smooth Transition",
    body: "We take a holistic approach to therapy, integrating mindfulness, relaxation techniques, and cognitive exercises into our sessions.",
  },
  {
    title: "Helping You Move Forward with Confidence",
    body: "By addressing the impact of life transitions, strengthening skills to cope, and creating personalized strategies, we help you make sense of change and embrace new beginnings.",
  },
];

const FAQS = [
  {
    q: "What are some examples of life transitions?",
    a: "Life transitions include a wide range of changes, such as:",
    bullets: [
      "Career shifts (starting a new job, losing a job, changing careers)",
      "Relationship changes (marriage, divorce, breakups, or loss of a loved one)",
      "Becoming a parent or navigating family dynamics",
      "Health challenges (illness, injury, or aging-related concerns)",
      "Moving to a new city or major relocation",
      "Entering a new phase of life, such as retirement or personal reinvention",
    ],
    after: "If you're going through any of these significant life changes, therapy can help you find clarity, cope with life transitions, and regain a sense of stability.",
  },
  {
    q: "How do I know if I need life transition therapy?",
    a: "If you're struggling with patterns and behaviors that make it difficult to adjust to life changes, seeking support from a life transition therapist may be beneficial. Signs that therapy could help include:",
    bullets: [
      "Feeling overwhelmed, anxious, or stuck during a transition",
      "Difficulty making decisions or moving forward after a significant change",
      "Increased stress, self-doubt, or emotional ups and downs",
      "Struggles with communication or relationships during a life transition",
      "Wanting to develop coping strategies to manage change more effectively",
    ],
    after: "",
  },
  {
    q: "What therapeutic techniques are used in life transition therapy?",
    a: "The strategies used in life transition therapy depend on your unique needs. At Brighter Tomorrow Counseling Center, we use a combination of:",
    bullets: [
      "Cognitive Behavioral Therapy (CBT) to shift thought patterns and improve resilience",
      "Mindfulness techniques to manage stress and anxiety during transitions",
      "Goal-setting strategies to help individuals move forward with clarity",
    ],
    after: "Each session is designed to help you adjust to life changes, regain balance, and help you grow through your transition.",
  },
  {
    q: "How long does life transition counseling last?",
    a: "The duration of counseling for life transitions varies based on the individual. Some clients find that short-term therapy helps them cope with life transitions effectively, while others may benefit from longer-term support, especially for significant life changes. Your therapist will work with you to create a personalized plan that aligns with your goals.",
    bullets: [],
    after: "",
  },
  {
    q: "Can life transition counseling help with smaller changes, or is it just for major transitions?",
    a: "There's no such thing as a “too small” transition. Life transitions include everything from beginning a new job to navigating an empty nest, and they all come with emotional adjustments. If a change is causing stress, uncertainty, or self-doubt, therapy offers a safe space to process those feelings and develop coping strategies. Even small changes can lead to big shifts in emotions, so seeking support is always a positive step.",
    bullets: [],
    after: "",
  },
];

export default function LifeTransitionsPage() {
  return (
    <article className="bg-white">
      {/* HERO */}
      <section className="relative overflow-hidden">
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{
            backgroundImage:
              "linear-gradient(rgba(15,22,30,0.55), rgba(15,22,30,0.55)), url('/images/specialties/life-transitions/01-Brighter-Tomorrow-Life-Transitions-2.webp')",
          }}
          aria-hidden
        />
        <div className="relative container-x py-28 sm:py-36 lg:py-44 text-center">
          <Reveal>
            <h1
              className="font-display font-bold leading-tight text-[40px] sm:text-[52px] lg:text-[60px]"
              style={{ color: "#F4F4F4" }}
            >
              <span style={{ color: GOLD }}>Life Transitions Counseling</span> in Las Vegas, NV
            </h1>
          </Reveal>
        </div>
      </section>

      {/* SECTION 2 — intro + image */}
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
                Big Life Changes? Try Therapy for Life Transitions to Build Resilience!
              </h2>
              <p className="mt-6 text-[15px] sm:text-[16px] leading-[1.75] text-ink-soft">
                Life is full of transitions—some exciting, some challenging, and some downright
                overwhelming. Whether you&rsquo;re starting a new job, adjusting to a major life
                change, or coping with the loss of a loved one, these shifts can bring a mix of
                emotions. While change is a natural part of life, it&rsquo;s not always easy to
                navigate it on your own. That&rsquo;s where life transition therapy can help.
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
                    src="/images/specialties/life-transitions/01-Brighter-Tomorrow-Life-Transitions-2.webp"
                    alt="Life transitions counseling in Las Vegas"
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

      {/* SECTION 3 — What Are Life Transitions */}
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
                    src="/images/specialties/life-transitions/02-Brighter-Tomorrow-Life-Transitions-3.webp"
                    alt="Person navigating a life transition"
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
                What Are Life Transitions?
              </h2>
              <p
                className="mt-6 font-display font-semibold text-[18px] sm:text-[20px] leading-[1.65]"
                style={{ color: WINE }}
              >
                Life transitions are significant shifts that can impact your emotions,
                relationships, and sense of stability.
              </p>
              <p className="mt-5 text-[16px] leading-[1.8] text-ink-soft">
                Whether you&rsquo;re starting a new job, losing a job, major medical conditions
                causing chronic pain or illness, becoming a parent, or coping with the death of a
                loved one, these changes can feel overwhelming.
              </p>
              <p className="mt-5 text-[16px] leading-[1.8] text-ink-soft">
                Major life transitions can disrupt your routine, challenge your sense of identity,
                and leave you searching for stability. Even positive life changes, like a promotion
                or moving to a new city, can trigger stress and uncertainty. That&rsquo;s why
                it&rsquo;s important to have healthy coping mechanisms to navigate the changes with
                confidence.
              </p>
            </Reveal>
          </div>
        </div>
      </section>

      {/* SECTION 4 — Benefits (cream card on wine band) */}
      <section style={{ backgroundColor: WINE }} className="relative">
        <div className="bg-cream pt-16 pb-20 px-4 sm:px-6 lg:px-10 mx-3 sm:mx-6 lg:mx-12 rounded-[40px] -my-10 relative z-10">
          <Reveal>
            <h3
              className="text-center font-display font-bold text-[28px] sm:text-[34px] lg:text-[37.5px]"
              style={{ color: INK }}
            >
              Benefits of Life Transitions Counseling
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
                Our Approach to Life Transitions Therapy
              </h3>
              <p className="mt-5 text-white/85 leading-[1.7] text-[15px]">
                With life transitions therapy at Brighter Tomorrow Counseling Center, you will
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
            Successfully Navigate Life Transitions with Brighter Tomorrow Counseling in Las
            Vegas, NV!
          </h3>
          <p className="mt-6 max-w-3xl mx-auto text-[15px] sm:text-[16px] leading-[1.75] text-ink-soft">
            If you or a loved one is struggling with a major life change, don&rsquo;t hesitate to
            seek support. Counseling for life transitions can help you navigate life transitions
            and regain a sense of control and confidence. Contact us today to learn more about how
            our counseling services can help you adjust to life changes and embrace your next
            chapter with clarity and strength.
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
                  <div className="mt-4 text-[15px] leading-[1.75] text-ink-soft">
                    <p>{faq.a}</p>
                    {faq.bullets.length > 0 && (
                      <ul className="mt-4 space-y-2">
                        {faq.bullets.map((b) => (
                          <li key={b} className="flex items-start gap-2">
                            <FiChevronRight
                              className="mt-1 shrink-0"
                              size={16}
                              style={{ color: WINE }}
                            />
                            <span>{b}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {faq.after && <p className="mt-4">{faq.after}</p>}
                  </div>
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
