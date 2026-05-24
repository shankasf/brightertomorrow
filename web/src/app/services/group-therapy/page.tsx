"use client";

import Link from "next/link";
import Image from "next/image";
import { motion } from "framer-motion";
import Reveal from "@/components/Reveal";
import {
  FiCheckCircle,
  FiUsers,
  FiTrendingUp,
  FiLifeBuoy,
  FiCompass,
} from "react-icons/fi";

const WINE = "#66202A";
const GOLD = "#E1B878";
const INK = "#192735";

const BENEFITS = [
  {
    Icon: FiUsers,
    title: "Shared Experiences",
    body: "For those undergoing similar life challenges — grief, addiction, or major life transitions — group therapy offers a space of mutual understanding.",
  },
  {
    Icon: FiTrendingUp,
    title: "Skill Development",
    body: "Individuals looking to enhance specific skills — communication, anger management, or stress reduction — can benefit from structured group sessions.",
  },
  {
    Icon: FiLifeBuoy,
    title: "Support Systems",
    body: "For those feeling isolated or alone in their struggles, group therapy provides a built-in support system, fostering connections and camaraderie.",
  },
  {
    Icon: FiCompass,
    title: "Personal Growth",
    body: "Individuals seeking broader perspectives and insights can gain immensely from the diverse experiences shared in group settings.",
  },
];

const APPROACH = [
  {
    title: "Safety First",
    body: "We prioritize creating a safe, confidential environment where members feel comfortable expressing themselves without fear of judgment.",
  },
  {
    title: "Diverse Groups",
    body: "Our groups are carefully curated to ensure a mix of backgrounds and experiences, enriching the collective learning process.",
  },
  {
    title: "Expert Facilitation",
    body: "Our therapists are trained in group dynamics, ensuring that every member feels heard, valued, and supported.",
  },
  {
    title: "Holistic Techniques",
    body: "Beyond discussions, we integrate activities, role-playing, and mindfulness practices to enhance the therapeutic experience.",
  },
  {
    title: "Structure with Flexibility",
    body: "While our sessions are structured around specific themes or challenges, we ensure there's ample room for organic discussions and sharing.",
  },
];

export default function GroupTherapyPage() {
  return (
    <article className="bg-white">
      <section className="relative overflow-hidden">
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{
            backgroundImage:
              "linear-gradient(rgba(15,22,30,0.55), rgba(15,22,30,0.55)), url('/images/services/group-therapy/hero.webp')",
          }}
          aria-hidden
        />
        <div className="relative container-x py-28 sm:py-36 lg:py-44 text-center">
          <Reveal>
            <h1 className="font-display font-bold leading-tight text-[40px] sm:text-[52px] lg:text-[60px]" style={{ color: "#F4F4F4" }}>
              <span style={{ color: GOLD }}>Group Therapy</span> in Las Vegas, NV
            </h1>
          </Reveal>
        </div>
      </section>

      <section className="bg-white">
        <div className="container-x py-20 lg:py-28">
          <div className="grid lg:grid-cols-12 gap-12 lg:gap-16 items-center">
            <Reveal className="lg:col-span-7">
              <h2 className="font-display font-bold leading-[1.15] text-[32px] sm:text-[40px] lg:text-[45px]" style={{ color: INK }}>
                Connect, share, and heal with a supportive community.
              </h2>
              <p className="mt-6 text-[15px] sm:text-[16px] leading-[1.75] text-ink-soft">
                In the journey of mental well-being, sometimes the collective
                experience can be as transformative as the individual one. Group
                therapy at Brighter Tomorrow offers a unique opportunity to
                grow, learn, and heal alongside others — fostering connections
                and shared understanding.
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
                  <Image src="/images/services/group-therapy/hero.webp" alt="Group therapy circle in session" fill priority sizes="(min-width:1024px) 420px, 100vw" className="object-cover" />
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
                  <Image src="/images/services/group-therapy/session.webp" alt="Therapist facilitating a group session" fill sizes="(min-width:1024px) 460px, 100vw" className="object-cover" />
                </motion.div>
              </div>
            </Reveal>
            <Reveal className="lg:col-span-7 order-1 lg:order-2">
              <h2 className="font-display font-bold leading-[1.15] text-[32px] sm:text-[40px] lg:text-[45px]" style={{ color: INK }}>
                What is Group Therapy?
              </h2>
              <p className="mt-6 font-display font-semibold text-[18px] sm:text-[20px] leading-[1.65]" style={{ color: WINE }}>
                Group therapy is a form of psychotherapy where a small,
                carefully selected group of individuals meets regularly under
                the guidance of a trained therapist.
              </p>
              <p className="mt-5 text-[16px] leading-[1.8] text-ink-soft">
                Unlike individual therapy, where the focus is on the one-on-one
                relationship between client and therapist, group therapy
                harnesses the collective experiences, insights, and support of
                its members.
              </p>
              <p className="mt-5 text-[16px] leading-[1.8] text-ink-soft">
                It provides a platform for participants to share their stories,
                challenges, and successes — all while learning from the diverse
                perspectives of their peers.
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
              Benefits of Group Therapy
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
                Our Approach to Group Therapy
              </h3>
              <p className="mt-5 text-white/85 leading-[1.7] text-[15px]">
                Structured, safe, and led by therapists trained in group
                dynamics — so every voice is heard.
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
              Embarking on a therapeutic journey with others can be a profound
              experience. At Brighter Tomorrow, our group therapy sessions are
              designed to offer support, insights, and a sense of community.
              Join us and discover the transformative power of shared healing.
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
