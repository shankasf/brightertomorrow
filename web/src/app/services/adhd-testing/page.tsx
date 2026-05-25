"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { motion, AnimatePresence } from "framer-motion";
import Reveal from "@/components/Reveal";
import {
  FiCheckCircle,
  FiChevronDown,
  FiTarget,
  FiBookOpen,
  FiFrown,
  FiVolume2,
  FiClock,
  FiPenTool,
  FiBriefcase,
  FiAlertCircle,
  FiHeart,
  FiClipboard,
  FiActivity,
  FiUsers,
  FiUserCheck,
} from "react-icons/fi";

const WINE = "#66202A";
const GOLD = "#E1B878";
const INK = "#192735";
const SAGE = "#6E7A8A";

const HERO_STATS = [
  { num: "1 in 10+", body: "Children in the United States are diagnosed with ADHD, making it one of the most common childhood neurodevelopmental conditions." },
  { num: "3x", body: "more likely for ADHD to be missed in girls than boys" },
  { num: "4.4%", body: "of adults in the U.S. live with ADHD, many undiagnosed until adulthood." },
];

const PRESENTATIONS = [
  {
    title: "Predominantly Inattentive",
    body: "Difficulty sustaining focus, following instructions, and completing tasks. Often described as 'daydreamy' or 'forgetful.' Commonly underdiagnosed, especially in girls and women.",
  },
  {
    title: "Predominantly Hyperactive-Impulsive",
    body: "Difficulty sitting still, waiting, and controlling impulses. More externally visible — symptoms that are often identified earlier in childhood.",
  },
  {
    title: "Combined Presentation",
    body: "The most common presentation, where symptoms of both inattention and hyperactivity/impulsivity are present together.",
  },
];

const IMPACT_CATEGORIES = [
  {
    title: "Academic & Career",
    body: "Academic and career performance often improves with the right support",
  },
  {
    title: "Relationships & Family",
    body: "Relationships and family dynamics get easier with shared language and tools",
  },
  {
    title: "Mental & Emotional Health",
    body: "Mental and emotional health improves when the root cause is named and addressed",
  },
];

const TREATABLE_STATS = [
  { num: "80%", body: "of individuals see significant improvement with consistent treatment" },
  { num: "2x", body: "better outcomes with combined therapy and parent involvement" },
];

const SIGNS = {
  children: [
    { Icon: FiTarget, title: "Difficulty Staying on Task", body: "Frequently shifts from one activity to another without completing work; easily pulled away by unrelated stimuli." },
    { Icon: FiBookOpen, title: "Struggles in School", body: "Careless mistakes, incomplete assignments, difficulty following multi-step directions, and losing important materials." },
    { Icon: FiFrown, title: "Emotional Outbursts", body: "Low frustration tolerance, intense emotional reactions to small setbacks, and difficulty calming down." },
    { Icon: FiVolume2, title: "Excessive Talking or Movement", body: "Constant motion, running, climbing at inappropriate times, talking non-stop even when asked to be quiet." },
    { Icon: FiClock, title: "Difficulty with Play", body: "Trouble engaging quietly in leisure activities, preferring constant stimulation, struggling with structured or turn-taking games." },
    { Icon: FiHeart, title: "Mental & Emotional Health", body: "Anxiety, low self-esteem, and frustration that build up when the underlying ADHD is not recognized or supported." },
  ],
  teens: [
    { Icon: FiPenTool, title: "Poor Organization", body: "Missed deadlines, lost assignments, messy backpacks and notebooks — strategies that worked before stop working." },
    { Icon: FiClock, title: "Hyperfocus on Screens", body: "Endless scrolling, gaming, or video binging while struggling to focus on schoolwork or chores." },
    { Icon: FiAlertCircle, title: "Risk-Taking Behavior", body: "Impulsive decisions around driving, substances, or social situations without weighing consequences." },
    { Icon: FiClock, title: "Sleep Disruption", body: "Trouble winding down at night and difficulty waking in the morning — a brain that struggles to switch gears." },
    { Icon: FiUsers, title: "Social Difficulties", body: "Trouble reading social cues, interrupting friends, or feeling rejected when relationships get tense." },
    { Icon: FiBookOpen, title: "Declining Academic Performance", body: "Grades drop as work gets harder; effort is not the problem — the support strategy is." },
  ],
  adults: [
    { Icon: FiPenTool, title: "Chronic Disorganization", body: "Paper piles, missed bills, forgotten appointments — even when you try hard, systems do not stick." },
    { Icon: FiActivity, title: "Mental Fog", body: "Difficulty starting tasks, slow processing, and a constant sense that your brain is one step behind." },
    { Icon: FiAlertCircle, title: "Overwhelm & Paralysis", body: "Too many tabs open in your head; even small decisions feel heavy and you freeze instead of acting." },
    { Icon: FiBriefcase, title: "Workplace Challenges", body: "Missed deadlines, half-finished projects, and feeling like you are working twice as hard for half the output." },
    { Icon: FiUsers, title: "Relationship Strain", body: "Partners and family feel unheard; forgotten plans and reactive moments add up over time." },
    { Icon: FiHeart, title: "Low Self-Esteem", body: "A lifetime of 'try harder' messaging builds shame, anxiety, and the belief that something is wrong with you." },
  ],
} as const;

const TREATMENT = [
  { Icon: FiClipboard, title: "Comprehensive Assessment", body: "Full evaluation across attention, impulse control, and activity levels to pinpoint what is happening." },
  { Icon: FiActivity, title: "Behavioral Therapy", body: "Evidence-based behavioral strategies tailored to your daily life, school, or work environment." },
  { Icon: FiUsers, title: "Parent Coaching", body: "Coaching for parents so the whole family has the tools to support a child with ADHD." },
  { Icon: FiBookOpen, title: "Psychoeducation", body: "Clear, plain-English education about how ADHD works — so you understand what is happening and why." },
  { Icon: FiUserCheck, title: "Collaborative Care Coordination", body: "We work with prescribers, schools, and other providers when appropriate so your support plan stays aligned." },
];

const FAQS = [
  {
    q: "Can ADHD be diagnosed in adults if they were never diagnosed as a child?",
    a: "Yes. Many adults — especially women — go undiagnosed as children because they masked symptoms or did not present with hyperactivity. A formal adult evaluation looks at lifelong patterns of attention, focus, and executive function.",
  },
  {
    q: "Does ADHD always require medication?",
    a: "No. Medication is one option, but evidence-based behavioral therapy, psychoeducation, and skills coaching are highly effective. Many people use a combination, and many do well without medication. We help you understand your options.",
  },
  {
    q: "How is ADHD diagnosed?",
    a: "Through a structured clinical evaluation that includes standardized assessments, a detailed history, symptom questionnaires (often including input from parents, teachers, or partners), and a review of how symptoms affect daily life.",
  },
  {
    q: "Is my child's ADHD caused by too much screen time or sugar?",
    a: "No. ADHD is a neurodevelopmental condition with a strong genetic component. Screens and sugar do not cause ADHD, though high screen use can worsen attention and sleep, which affects symptom management.",
  },
  {
    q: "Will my child outgrow ADHD?",
    a: "Most children do not 'outgrow' ADHD, but symptoms often change over time. With the right tools — therapy, structure, and sometimes medication — many people learn to thrive with ADHD as adults.",
  },
  {
    q: "What if ADHD is not the only issue my child or I am dealing with?",
    a: "That is very common. ADHD often co-occurs with anxiety, depression, learning differences, or trauma. A thorough evaluation looks at the whole picture so the support plan addresses what is actually going on.",
  },
];

export default function AdhdTestingPage() {
  const [tab, setTab] = useState<"children" | "teens" | "adults">("children");
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  return (
    <article className="bg-white">
      {/* HERO */}
      <section className="relative overflow-hidden">
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{
            backgroundImage:
              "linear-gradient(rgba(15,22,30,0.55), rgba(15,22,30,0.55)), url('/images/services/adhd-testing/hero.webp')",
          }}
          aria-hidden
        />
        <div className="relative container-x py-28 sm:py-36 lg:py-44 text-center">
          <Reveal>
            <h1
              className="font-display font-bold leading-tight text-[40px] sm:text-[52px] lg:text-[60px]"
              style={{ color: "#F4F4F4" }}
            >
              <span style={{ color: GOLD }}>ADHD Testing</span>
            </h1>
          </Reveal>
        </div>
      </section>

      {/* SECTION 2 — You Are Not Broken + stats + image */}
      <section className="bg-white">
        <div className="container-x py-20 lg:py-28">
          <div className="grid lg:grid-cols-12 gap-12 lg:gap-16 items-center">
            <Reveal className="lg:col-span-7">
              <p
                className="font-script italic text-[18px] sm:text-[20px] mb-3"
                style={{ color: WINE }}
              >
                ADHD Treatment &amp; Support
              </p>
              <h2
                className="font-display font-bold leading-[1.15] text-[32px] sm:text-[40px] lg:text-[45px]"
                style={{ color: INK }}
              >
                You Are Not Broken. <br className="hidden sm:block" />
                You Are <span style={{ color: WINE }}>Wired Differently.</span>
              </h2>
              <p className="mt-6 text-[15px] sm:text-[16px] leading-[1.75] text-ink-soft">
                ADHD is one of the most common and most misunderstood
                neurodevelopmental conditions. At Brighter Tomorrow, our
                clinicians provide compassionate, evidence-based support for
                children and adults navigating life with ADHD.
              </p>

              <div className="mt-8 grid sm:grid-cols-3 gap-4">
                {HERO_STATS.map((s) => (
                  <div
                    key={s.num}
                    className="p-5"
                    style={{
                      border: `1px solid ${WINE}`,
                      borderRadius: "20px 0 20px 20px",
                    }}
                  >
                    <p
                      className="font-display font-bold text-[22px] sm:text-[26px]"
                      style={{ color: WINE }}
                    >
                      {s.num}
                    </p>
                    <p className="mt-2 text-[12.5px] leading-[1.5] text-ink-soft">{s.body}</p>
                  </div>
                ))}
              </div>

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
                    src="/images/services/adhd-testing/secondary.webp"
                    alt="Person reflecting in natural sunlight"
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

      {/* SECTION 3 — What is ADHD? + image + 3 presentations */}
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
                    src="/images/services/adhd-testing/whatis.webp"
                    alt="Person with headphones in soft daylight"
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
                What is ADHD?
              </h2>
              <p
                className="mt-6 font-display font-semibold text-[16px] sm:text-[18px]"
                style={{ color: WINE }}
              >
                Understanding ADHD
              </p>
              <p className="mt-3 text-[15px] sm:text-[16px] leading-[1.75] text-ink-soft">
                Attention-Deficit/Hyperactivity Disorder (ADHD) is a
                neurodevelopmental condition that affects how the brain
                regulates attention, impulse control, and activity levels. It
                is not a character flaw or a result of poor parenting.
              </p>
              <p className="mt-4 text-[15px] sm:text-[16px] leading-[1.75] text-ink-soft">
                ADHD affects people of every age, gender, background, and level
                of intelligence. Symptoms often look very different across
                different individuals, which is why many people go years
                without an accurate diagnosis.
              </p>
              <p className="mt-4 text-[15px] sm:text-[16px] leading-[1.75] text-ink-soft">
                With the right support, people with ADHD can and do thrive.
                Understanding what you or your child is experiencing is the
                first step toward building a life that works with your brain,
                not against it.
              </p>

              <div className="mt-7 space-y-5">
                {PRESENTATIONS.map((p) => (
                  <div key={p.title}>
                    <p
                      className="font-display font-bold text-[16.5px] sm:text-[18px]"
                      style={{ color: WINE }}
                    >
                      {p.title}
                    </p>
                    <p className="mt-1.5 text-[14.5px] leading-[1.65] text-ink-soft">{p.body}</p>
                  </div>
                ))}
              </div>

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
        </div>
      </section>

      {/* SECTION 4 — Real-World Impact (wine band, 3 categories) */}
      <section style={{ backgroundColor: WINE }} className="py-20 lg:py-24">
        <div className="container-x">
          <Reveal>
            <h3 className="text-center font-display font-bold text-white text-[28px] sm:text-[34px] lg:text-[40px] leading-[1.15]">
              Real-World <span style={{ color: GOLD }}>Impact</span> of Untreated ADHD
            </h3>
            <p className="mt-5 text-center text-white/85 text-[15px] sm:text-[16px] max-w-[760px] mx-auto leading-[1.7]">
              Untreated ADHD does not simply mean someone is a little
              scattered. Over time, the effects touch every part of a person&rsquo;s
              life. Early identification and consistent support change outcomes
              dramatically.
            </p>
          </Reveal>

          <div className="mt-12 grid lg:grid-cols-12 gap-10 items-center">
            <Reveal className="lg:col-span-5">
              <div className="relative mx-auto max-w-[420px]">
                <div
                  className="absolute -bottom-6 -left-6 w-full h-full"
                  style={{ backgroundColor: GOLD, borderRadius: "60px 0 60px 60px" }}
                  aria-hidden
                />
                <motion.div
                  className="relative aspect-[4/5] overflow-hidden"
                  style={{ borderRadius: "60px 0 60px 60px" }}
                  whileHover={{ scale: 1.02 }}
                  transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                >
                  <Image
                    src="/images/services/adhd-testing/impact.webp"
                    alt="Person working through challenges at a desk"
                    fill
                    sizes="(min-width:1024px) 420px, 100vw"
                    className="object-cover"
                  />
                </motion.div>
              </div>
            </Reveal>

            <div className="lg:col-span-7 space-y-6">
              {IMPACT_CATEGORIES.map((c, i) => (
                <Reveal key={c.title} delay={i * 0.07}>
                  <div className="flex items-start gap-4">
                    <span
                      className="mt-0.5 inline-grid place-items-center w-9 h-9 shrink-0 rounded-full"
                      style={{ border: `2px solid ${GOLD}`, color: GOLD }}
                    >
                      <FiCheckCircle size={20} strokeWidth={2} />
                    </span>
                    <div>
                      <h4 className="font-display font-bold text-white text-[18px] sm:text-[20px] leading-[1.25]">
                        {c.title}
                      </h4>
                      <p className="mt-2 text-white/85 text-[14.5px] leading-[1.65]">{c.body}</p>
                    </div>
                  </div>
                </Reveal>
              ))}

              <Reveal delay={0.25}>
                <div className="pt-2">
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
          </div>
        </div>
      </section>

      {/* SECTION 5 — ADHD Is Treatable + 2 stat cards */}
      <section className="bg-white py-20 lg:py-24">
        <div className="container-x">
          <Reveal>
            <h3
              className="text-center font-display font-bold text-[28px] sm:text-[34px] lg:text-[40px] leading-[1.15]"
              style={{ color: INK }}
            >
              ADHD Is <span style={{ color: WINE }}>Treatable</span>
            </h3>
            <p className="mt-5 text-center text-ink-soft text-[15px] sm:text-[16px] max-w-[760px] mx-auto leading-[1.7]">
              Research consistently shows that a combination of behavioral
              therapy, psychoeducation, and individualized support produces
              meaningful and lasting improvements in daily functioning,
              relationships, and quality of life.
            </p>
          </Reveal>

          <div className="mt-12 grid sm:grid-cols-2 gap-6 max-w-[760px] mx-auto">
            {TREATABLE_STATS.map((s, i) => (
              <Reveal key={s.num} delay={i * 0.08}>
                <div
                  className="p-7 text-center"
                  style={{
                    border: `1px solid ${WINE}`,
                    borderRadius: "30px 0 30px 30px",
                  }}
                >
                  <p
                    className="font-display font-bold text-[36px] sm:text-[44px]"
                    style={{ color: WINE }}
                  >
                    {s.num}
                  </p>
                  <p className="mt-3 text-[14.5px] leading-[1.65] text-ink-soft">{s.body}</p>
                </div>
              </Reveal>
            ))}
          </div>

          <Reveal delay={0.18}>
            <div className="mt-10 text-center">
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

      {/* SECTION 6 — Signs & Symptoms (sage band, tabs) */}
      <section style={{ backgroundColor: SAGE }} className="py-20 lg:py-24">
        <div className="container-x">
          <Reveal>
            <p
              className="text-center font-script italic text-[22px] sm:text-[26px]"
              style={{ color: GOLD }}
            >
              Signs &amp; Symptoms
            </p>
            <p className="mt-4 text-center text-white/90 text-[15px] sm:text-[16px] max-w-[860px] mx-auto leading-[1.7]">
              ADHD does not look one way. These are some of the most common
              presentations we see across different stages of life.
            </p>
          </Reveal>

          <Reveal delay={0.05}>
            <div className="mt-10 flex justify-center gap-3 sm:gap-4 flex-wrap">
              {(
                [
                  ["children", "In Children"],
                  ["teens", "In Teenagers"],
                  ["adults", "In Adults"],
                ] as const
              ).map(([k, label]) => {
                const active = tab === k;
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setTab(k)}
                    className="px-6 py-3 font-display font-bold text-[13.5px] sm:text-[14.5px] transition"
                    style={{
                      backgroundColor: active ? WINE : "transparent",
                      color: active ? GOLD : "#FFFFFF",
                      border: active ? `1px solid ${WINE}` : `1px solid ${GOLD}`,
                      borderRadius: "30px 0 30px 30px",
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </Reveal>

          <div className="mt-10 grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            <AnimatePresence mode="wait">
              <motion.div
                key={tab}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                className="contents"
              >
                {SIGNS[tab].map(({ Icon, title, body }, i) => (
                  <motion.div
                    key={title}
                    initial={{ opacity: 0, y: 14 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.45, delay: i * 0.05, ease: [0.16, 1, 0.3, 1] }}
                    className="bg-white p-7"
                    style={{
                      borderRadius: "30px 0 30px 30px",
                      border: `1px solid ${i % 2 === 0 ? WINE : GOLD}`,
                    }}
                  >
                    <span
                      className="inline-grid place-items-center w-12 h-12"
                      style={{ color: WINE }}
                    >
                      <Icon size={30} strokeWidth={1.5} />
                    </span>
                    <h4
                      className="mt-2 font-display font-bold text-[18px] leading-[1.3]"
                      style={{ color: WINE }}
                    >
                      {title}
                    </h4>
                    <p className="mt-2 text-[14px] leading-[1.65] text-ink-soft">{body}</p>
                  </motion.div>
                ))}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </section>

      {/* SECTION 7 — Evidence-Based Treatment (wine band) */}
      <section style={{ backgroundColor: WINE }} className="py-20 lg:py-24">
        <div className="container-x">
          <Reveal>
            <p
              className="text-center font-script italic text-[22px] sm:text-[26px]"
              style={{ color: GOLD }}
            >
              Evidence-Based Treatment That Works
            </p>
            <p className="mt-3 text-center font-display font-bold text-white text-[24px] sm:text-[30px]">
              Our Approach
            </p>
          </Reveal>

          <div className="mt-12 grid sm:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-7">
            {TREATMENT.map(({ Icon, title, body }, i) => (
              <Reveal key={title} delay={i * 0.07}>
                <div
                  className="h-full bg-white p-7"
                  style={{
                    borderRadius: "30px 0 30px 30px",
                    border: `1px solid ${i === 0 ? WINE : GOLD}`,
                  }}
                >
                  <span
                    className="inline-grid place-items-center w-12 h-12"
                    style={{ color: WINE }}
                  >
                    <Icon size={30} strokeWidth={1.5} />
                  </span>
                  <h4
                    className="mt-2 font-display font-bold text-[18px] leading-[1.3]"
                    style={{ color: INK }}
                  >
                    {title}
                  </h4>
                  <p className="mt-2 text-[14px] leading-[1.65] text-ink-soft">{body}</p>
                </div>
              </Reveal>
            ))}
          </div>

          <Reveal delay={0.25}>
            <div className="mt-10 text-center">
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

      {/* SECTION 8 — FAQ */}
      <section className="bg-white py-20 lg:py-24">
        <div className="container-x max-w-[860px]">
          <Reveal>
            <h3
              className="text-center font-display font-bold text-[28px] sm:text-[34px] lg:text-[37.5px]"
              style={{ color: INK }}
            >
              Frequently Asked Questions
            </h3>
          </Reveal>
          <div className="mt-12 space-y-4">
            {FAQS.map((f, i) => {
              const open = openFaq === i;
              return (
                <Reveal key={f.q} delay={i * 0.04}>
                  <div
                    style={{
                      backgroundColor: WINE,
                      borderRadius: "30px 0 30px 30px",
                    }}
                    className="overflow-hidden"
                  >
                    <button
                      type="button"
                      onClick={() => setOpenFaq(open ? null : i)}
                      aria-expanded={open}
                      className="w-full flex items-center justify-between gap-4 px-6 sm:px-8 py-5 text-left"
                    >
                      <span className="font-display font-bold text-white text-[15.5px] sm:text-[17px] leading-[1.35]">
                        {f.q}
                      </span>
                      <motion.span
                        animate={{ rotate: open ? 180 : 0 }}
                        transition={{ duration: 0.3 }}
                        className="shrink-0"
                        style={{ color: GOLD }}
                      >
                        <FiChevronDown size={22} />
                      </motion.span>
                    </button>
                    <AnimatePresence initial={false}>
                      {open && (
                        <motion.div
                          key="content"
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                          className="overflow-hidden"
                        >
                          <div className="px-6 sm:px-8 pb-6 text-white/90 text-[14.5px] leading-[1.7]">
                            {f.a}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </Reveal>
              );
            })}
          </div>
        </div>
      </section>

      {/* SECTION 9 — CTA banner */}
      <section className="relative overflow-hidden" style={{ backgroundColor: SAGE }}>
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{
            backgroundImage:
              "linear-gradient(rgba(15,22,30,0.62), rgba(15,22,30,0.62)), url('/images/services/cta-bg.webp')",
          }}
          aria-hidden
        />
        <div className="container-x py-20 lg:py-24 text-center relative z-10">
          <Reveal>
            <p
              className="font-script italic text-[20px] sm:text-[24px]"
              style={{ color: GOLD }}
            >
              Ready to begin your healing journey?
            </p>
            <h3 className="mt-3 font-display font-bold text-[32px] sm:text-[40px] lg:text-[45px] text-white leading-[1.15]">
              You Do Not Have to Figure This Out{" "}
              <span style={{ color: GOLD }}>Alone</span>
            </h3>
            <p className="mt-5 max-w-[720px] mx-auto text-white/90 text-[15px] sm:text-[16px] leading-[1.7]">
              Whether you are a parent seeking support for your child or an
              adult finally ready to understand your own mind, our team is
              here. Brighter Tomorrow Counseling Services accepts most major
              insurance plans and offers flexible scheduling.
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
    </article>
  );
}
