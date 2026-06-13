"use client";

import Link from "next/link";
import Image from "next/image";
import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import Reveal from "@/components/Reveal";
import {
  FiCheckCircle,
  FiChevronDown,
  FiActivity,
  FiHeart,
  FiCompass,
  FiHome,
} from "react-icons/fi";

const WINE = "#66202A";
const GOLD = "#E1B878";
const INK = "#192735";

const BENEFITS = [
  {
    Icon: FiActivity,
    title: "No More Feeling Stuck in Your Grief",
    body: "A grief therapist can help you process your feelings in a way that feels manageable. Bereavement counseling helps you make sense of your emotions and work through any feelings of being stuck in your grief.",
  },
  {
    Icon: FiHeart,
    title: "Healthy Coping Skills for Your Heartbreak",
    body: "Grief counseling offers personalized strategies to help you work through grief and loss in a healthy, sustainable way. Your grief therapist will help you develop tools to navigate this significant life change.",
  },
  {
    Icon: FiCompass,
    title: "Manage Intense Emotions in a Healthy Way",
    body: "Grief often brings up feelings of anxiety, depression, and profound emotional distress. Grief counseling will help you manage the intense emotions that come with loss and find your balance.",
  },
  {
    Icon: FiHome,
    title: "Rebuild a Sense of Normalcy and Belonging",
    body: "Grief counseling provides support to help you pave the way toward rebuilding your life in a way that feels meaningful. You will learn ways to explore your new normal and move forward without feeling guilty.",
  },
];

const APPROACH = [
  {
    title: "Tailored Support for Your Healing",
    body: "There’s no single path to healing, which is why we use a client-centered approach to meet your individual needs.",
  },
  {
    title: "Understanding the Root of Grief",
    body: "Our therapists take the time to go deeper, helping you process your feelings and uncover underlying challenges that may be making the grieving process even harder.",
  },
  {
    title: "Compassionate, Collaborative Care",
    body: "Whether you’re seeking grief counseling for prolonged grief, struggling with a life transition, or needing support and guidance, our therapists are here to walk alongside you.",
  },
  {
    title: "Integrative Healing for Mind & Body",
    body: "Our approach integrates mindfulness, relaxation techniques, and therapeutic approaches to help clients process a loss in a confidential environment that promotes growth and transformation.",
  },
  {
    title: "Expert Guidance from Compassionate Professionals",
    body: "Our team of grief counselors brings a wealth of experience in grief and bereavement counseling so you can receive the highest level of care.",
  },
];

type FaqItem = { q: string; a: React.ReactNode };

const FAQS: FaqItem[] = [
  {
    q: "What types of grief do you help with?",
    a: (
      <>
        <p className="text-[15px] text-ink-soft leading-[1.75]">
          We support individuals facing all types of loss, including:
        </p>
        <ul className="mt-3 list-disc pl-5 space-y-1.5 text-[15px] text-ink-soft leading-[1.7]">
          <li>
            The death of a loved one (spouse, family member, friend, or pet)
          </li>
          <li>Loss related to end-of-life care and anticipatory grief</li>
          <li>Divorce, separation, or loss of a significant relationship</li>
          <li>
            Loss of identity, independence, or health due to aging or illness
          </li>
        </ul>
      </>
    ),
  },
  {
    q: "Is grief counseling right for me?",
    a: (
      <>
        <p className="text-[15px] text-ink-soft leading-[1.75]">
          Grief counseling is for anyone who is struggling with loss—whether
          it&rsquo;s recent or something that still weighs heavily on your
          heart. You might benefit from seeking grief counseling if:
        </p>
        <ul className="mt-3 list-disc pl-5 space-y-1.5 text-[15px] text-ink-soft leading-[1.7]">
          <li>You feel stuck in your grief and unable to move forward.</li>
          <li>
            The loss of a loved one has made everyday life feel overwhelming.
          </li>
          <li>
            You&rsquo;re experiencing prolonged grief—deep sadness, guilt,
            anger, or numbness that won&rsquo;t seem to go away.
          </li>
          <li>
            You&rsquo;re struggling with anxiety, depression, or a significant
            life change following your loss.
          </li>
        </ul>
      </>
    ),
  },
  {
    q: "How long does grief counseling take?",
    a: (
      <p className="text-[15px] text-ink-soft leading-[1.75]">
        Grief doesn&rsquo;t follow a set timeline—every loss is unique, and so
        is the healing process. Some people find relief after just a few
        sessions, while others need longer-term support to work through the
        death of a loved one or other significant emotional challenges.
      </p>
    ),
  },
  {
    q: "Are grief counseling and bereavement counseling the same thing?",
    a: (
      <p className="text-[15px] text-ink-soft leading-[1.75]">
        While bereavement counseling and grief counseling are closely related,
        they&rsquo;re not exactly the same. Think of grief counseling as the
        broad umbrella that helps people process all kinds of losses, while
        bereavement counseling is a more specific type of support focused on
        coping with the loss of a loved one.
      </p>
    ),
  },
  {
    q: "What happens in a grief counseling session?",
    a: (
      <>
        <p className="text-[15px] text-ink-soft leading-[1.75]">
          Grief counseling is tailored to your unique needs, but sessions may
          include:
        </p>
        <ul className="mt-3 list-disc pl-5 space-y-1.5 text-[15px] text-ink-soft leading-[1.7]">
          <li>
            Exploring emotions surrounding your loss in a confidential,
            judgment-free space
          </li>
          <li>Learning coping strategies to manage overwhelming feelings</li>
          <li>
            Identifying any barriers to healing, such as unresolved guilt or
            anger
          </li>
          <li>
            Using therapeutic techniques like EMDR, mindfulness, brain spotting,
            CBT or Parts and Memory Therapy
          </li>
          <li>Finding ways to honor your loved one while moving forward</li>
        </ul>
        <p className="mt-3 text-[15px] text-ink-soft leading-[1.75]">
          Whether through individual counseling or grief support groups, we
          focus on creating a therapeutic relationship that feels compassionate
          and supportive.
        </p>
      </>
    ),
  },
];

function FaqRow({ item, idx }: { item: FaqItem; idx: number }) {
  const [open, setOpen] = useState(false);
  return (
    <Reveal delay={idx * 0.05}>
      <div
        className="overflow-hidden"
        style={{
          backgroundColor: WINE,
          borderRadius: "30px 0 30px 30px",
        }}
      >
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="w-full flex items-center justify-between gap-4 px-6 sm:px-8 py-5 text-left transition-colors hover:bg-[#5a1c25]"
        >
          <span className="font-display font-bold text-white text-[15px] sm:text-[17px] leading-[1.4]">
            {item.q}
          </span>
          <motion.span
            animate={{ rotate: open ? 180 : 0 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
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
            >
              <div className="bg-white px-6 sm:px-8 py-6">{item.a}</div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </Reveal>
  );
}

export default function GriefCounselingPage() {
  return (
    <article className="bg-white">
      {/* HERO */}
      <section className="relative overflow-hidden">
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{
            backgroundImage:
              "linear-gradient(rgba(15,22,30,0.6), rgba(15,22,30,0.6)), url('/images/specialties/grief-counseling/00-Brighter-Tomorrow-Grief-Counseling-hero.webp')",
          }}
          aria-hidden
        />
        <div className="relative container-x py-28 sm:py-36 lg:py-44 text-center">
          <Reveal>
            <h1
              className="font-display font-bold leading-tight text-[40px] sm:text-[52px] lg:text-[60px]"
              style={{ color: "#F4F4F4" }}
            >
              <span style={{ color: GOLD }}>Grief Counseling</span> in Las
              Vegas, NV
            </h1>
          </Reveal>
        </div>
      </section>

      {/* SECTION 2 — Intro */}
      <section className="bg-white">
        <div className="container-x py-20 lg:py-28">
          <div className="grid lg:grid-cols-12 gap-12 lg:gap-16 items-center">
            <Reveal className="lg:col-span-7">
              <p
                className="font-script italic text-[20px] sm:text-[22px]"
                style={{ color: GOLD }}
              >
                Compassionate Grief Therapy for Life&rsquo;s Toughest Losses.
              </p>
              <h2
                className="mt-3 font-display font-bold leading-[1.15] text-[32px] sm:text-[40px] lg:text-[45px]"
                style={{ color: INK }}
              >
                Creating a Brighter Tomorrow, Today.
              </h2>
              <p className="mt-6 text-[15px] sm:text-[16px] leading-[1.75] text-ink-soft">
                A significant loss can feel overwhelming, isolating, and
                impossible to navigate alone. At Brighter Tomorrow Counseling,
                we offer grief counseling to help you process the loss of a
                loved one, manage difficult emotions, and find a path
                forward—at your own pace in a safe space.
              </p>
              <div className="mt-8">
                <Link
                  href="https://brightertomorrow.janeapp.com/" target="_blank" rel="noopener noreferrer"
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
                    src="/images/specialties/grief-counseling/img-1.webp"
                    alt="A single red rose resting in memory"
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

      {/* SECTION 3 — What is Grief Counseling */}
      <section className="bg-white">
        <div className="container-x pb-20 lg:pb-28">
          <div className="grid lg:grid-cols-12 gap-12 lg:gap-16 items-center">
            <Reveal className="lg:col-span-5 order-2 lg:order-1"
            >
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
                    src="/images/specialties/grief-counseling/img-2.webp"
                    alt="Quiet outdoor scene evoking remembrance"
                    fill
                    sizes="(min-width:1024px) 460px, 100vw"
                    className="object-cover"
                  />
                </motion.div>
              </div>
            </Reveal>

            <Reveal className="lg:col-span-7 order-1 lg:order-2"
            >
              <h2
                className="font-display font-bold leading-[1.15] text-[32px] sm:text-[40px] lg:text-[45px]"
                style={{ color: INK }}
              >
                What is Grief Counseling?
              </h2>
              <p
                className="mt-6 font-display font-semibold text-[18px] sm:text-[20px] leading-[1.65]"
                style={{ color: WINE }}
              >
                Grief is unique to each person, and there&rsquo;s no right or
                wrong way to go through it. But one thing is certain: you
                don&rsquo;t have to go through it alone. That&rsquo;s where
                grief counseling comes in.
              </p>
              <p className="mt-5 text-[16px] leading-[1.8] text-ink-soft">
                A grief counselor provides a safe space—a place where you can
                be yourself, where you don&rsquo;t have to pretend
                you&rsquo;re okay when you&rsquo;re not. Grief therapy and
                counseling give you the support, tools, and understanding you
                need to process your loss at your own pace. Whether your grief
                feels raw and overwhelming or like an ache that won&rsquo;t go
                away, a grief therapist can help you make sense of your
                emotions and find a path forward toward healing.
              </p>
              <div className="mt-8">
                <Link
                  href="https://brightertomorrow.janeapp.com/" target="_blank" rel="noopener noreferrer"
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

      {/* SECTION 4 — Benefits cards on wine band */}
      <section style={{ backgroundColor: WINE }} className="relative">
        <div className="bg-cream pt-16 pb-20 px-4 sm:px-6 lg:px-10 mx-3 sm:mx-6 lg:mx-12 rounded-[40px] -my-10 relative z-10">
          <Reveal>
            <h3
              className="text-center font-display font-bold text-[28px] sm:text-[34px] lg:text-[37.5px]"
              style={{ color: INK }}
            >
              Benefits of Grief and Loss Counseling
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

      {/* SECTION 5 — Our Approach to Therapy for Grief (wine bg, white text) */}
      <section style={{ backgroundColor: WINE }} className="pt-28 pb-20">
        <div className="container-x">
          <div className="grid lg:grid-cols-12 gap-10 lg:gap-12">
            <Reveal className="lg:col-span-4">
              <h3 className="font-display font-bold text-[28px] sm:text-[34px] lg:text-[37.5px] text-white leading-[1.2]">
                Our Approach to Therapy for Grief
              </h3>
              <p className="mt-5 text-white/85 leading-[1.7] text-[15px]">
                With grief counseling at Brighter Tomorrow Counseling Center,
                you will receive:
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
                href="https://brightertomorrow.janeapp.com/" target="_blank" rel="noopener noreferrer"
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

      {/* SECTION 6 — Allow Yourself to Move Forward (cream-alt bg, centered) */}
      <section className="bg-cream-alt py-20 lg:py-24">
        <div className="container-x text-center max-w-3xl mx-auto">
          <Reveal>
            <p
              className="font-script italic text-[22px] sm:text-[26px]"
              style={{ color: GOLD }}
            >
              Take the first step
            </p>
            <h3
              className="mt-3 font-display font-bold text-[28px] sm:text-[34px] lg:text-[37.5px] leading-[1.2]"
              style={{ color: INK }}
            >
              Allow Yourself to Move Forward!
              <br />
              Talk to a Grief Counselor in Las Vegas, NV!
            </h3>
            <p className="mt-6 text-[15px] sm:text-[16px] leading-[1.8] text-ink-soft">
              If you&rsquo;re looking for grief counseling in the Las Vegas
              area, we offer in-person and telehealth counseling sessions to fit
              your needs. Therapy can help, and you don&rsquo;t have to go
              through this alone. Schedule a free consultation today, and
              let&rsquo;s take this step toward healing and moving forward
              together.
            </p>
          </Reveal>

          <Reveal delay={0.15}>
            <div className="mt-10 flex justify-center">
              <Link
                href="https://brightertomorrow.janeapp.com/" target="_blank" rel="noopener noreferrer"
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

      {/* SECTION 7 — FAQs */}
      <section className="bg-white py-20 lg:py-24">
        <div className="container-x max-w-4xl mx-auto">
          <Reveal>
            <h3
              className="text-center font-display font-bold text-[28px] sm:text-[34px] lg:text-[37.5px] mb-10"
              style={{ color: INK }}
            >
              Frequently Asked Questions
            </h3>
          </Reveal>
          <div className="space-y-4">
            {FAQS.map((it, i) => (
              <FaqRow key={it.q} item={it} idx={i} />
            ))}
          </div>
        </div>
      </section>

      {/* SECTION 8 — CTA banner */}
      <section
        className="relative overflow-hidden"
        style={{ backgroundColor: "#6E7A8A" }}
      >
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{
            backgroundImage:
              "linear-gradient(rgba(110,122,138,0.78), rgba(110,122,138,0.78)), url('/images/specialties/grief-counseling/03-cta-bg.webp')",
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
