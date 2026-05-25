import Link from "next/link";
import Image from "next/image";
import {
  FiArrowRight,
  FiEye,
  FiHeart,
  FiSmile,
  FiTarget,
  FiCompass,
  FiUser,
  FiUsers,
  FiBookOpen,
} from "react-icons/fi";

export const metadata = {
  title: "Careers — Join Our Team",
  description:
    "Are you passionate about making a difference in the lives of Nevada residents? Join the Brighter Tomorrow team and help provide holistic healing, growth, and happiness.",
};

const WINE = "#66202A";
const GOLD = "#E1B878";
const JOTFORM_APPLY = "https://form.jotform.com/260598144335057";

const LOOKING_FOR = [
  {
    icon: FiEye,
    title: "Attentive & Meticulous",
    body: "Detail-oriented, especially when it comes to matters that are significant to our clients.",
  },
  {
    icon: FiHeart,
    title: "Passionate",
    body: "Driven by a genuine desire to help clients find safer grounds and grow into their happiest selves.",
  },
  {
    icon: FiSmile,
    title: "Friendly & Approachable",
    body: "Creating a supportive environment where clients feel safe, understood, and cared for.",
  },
  {
    icon: FiTarget,
    title: "Solution-Oriented",
    body: "Capable of understanding the challenges our clients face and developing clear, effective recovery plans.",
  },
];

const WHY_JOIN = [
  {
    icon: FiCompass,
    title: "We're Mission-Driven",
    body: "At Brighter Tomorrow, our mission is not just our business name but the essence of our practice. We are dedicated to ensuring a better tomorrow for all our clients.",
  },
  {
    icon: FiUser,
    title: "We Offer a Personalized Approach",
    body: "We believe in tailoring our therapeutic approaches to the unique needs and experiences of each client, ensuring they receive the best possible care.",
  },
  {
    icon: FiUsers,
    title: "We Provide a Supportive Environment",
    body: "Our team is a close-knit community of professionals who support and uplift each other, fostering an environment of growth and collaboration.",
  },
  {
    icon: FiBookOpen,
    title: "We Value Continuous Learning",
    body: "We value continuous education and encourage our team members to pursue further training and certifications to enhance their skills and expertise.",
  },
];

export default function CareersPage() {
  return (
    <>
      {/* ─────────────────────────────────────────────────────────────
          1) HERO — full-bleed dusk landscape, dark overlay, centered
          ───────────────────────────────────────────────────────────── */}
      <section className="relative isolate flex min-h-[600px] items-center justify-center overflow-hidden lg:min-h-[760px]">
        <div
          aria-hidden
          className="absolute inset-0 -z-10 bg-cover bg-center"
          style={{
            backgroundImage: `linear-gradient(180deg, rgba(25,39,53,0.74) 0%, rgba(25,39,53,0.84) 100%), url('/careers/hero.jpg')`,
          }}
        />
        <div className="container-x py-24 text-center sm:py-28">
          <h1 className="display text-5xl leading-[1.08] text-white sm:text-6xl lg:text-7xl">
            <span style={{ color: GOLD }}>Join</span> Our Team
          </h1>
        </div>
      </section>

      {/* ─────────────────────────────────────────────────────────────
          2) INTRO — two columns on cream; offset blush photo card
          ───────────────────────────────────────────────────────────── */}
      <section className="section bg-cream-alt">
        <div className="container-x">
          <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
            {/* LEFT — copy */}
            <div>
              <p className="italic-accent text-lg" style={{ color: GOLD }}>
                Brighter lives, brighter futures, brighter careers.
              </p>
              <h2 className="mt-5 display text-[2.5rem] leading-[1.12] text-ink sm:text-[3rem] lg:text-[3.25rem]">
                Are you passionate about making a{" "}
                <span className="italic-accent">
                  difference in the lives of Nevada residents
                </span>
                ?
              </h2>
              <p className="mt-7 max-w-xl leading-relaxed text-ink-muted">
                At Brighter Tomorrow, we believe that everyone deserves a
                brighter life, a brighter future, and a brighter tomorrow. If you
                share this belief and are passionate about making a difference in
                the lives of those struggling with mental health challenges, we
                would love to hear from you. Join us in our mission to provide
                holistic healing, growth, and happiness.
              </p>
              <a
                href={JOTFORM_APPLY}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-primary mt-9 inline-flex"
              >
                Join our Team <FiArrowRight size={15} aria-hidden />
              </a>
            </div>

            {/* RIGHT — photo with blush offset block behind it */}
            <div className="relative mx-auto w-full max-w-md lg:mx-0 lg:ml-auto">
              <div
                aria-hidden
                className="absolute -right-5 -top-5 bottom-5 left-12 -z-10"
                style={{
                  backgroundColor: "#f3e3e6",
                  borderRadius: "28px 0 28px 28px",
                }}
              />
              <Image
                src="/careers/team.webp"
                alt="The Brighter Tomorrow team"
                width={1200}
                height={1343}
                sizes="(max-width: 1024px) 28rem, 28rem"
                className="h-auto w-full object-cover shadow-[0_20px_60px_-28px_rgba(25,39,53,0.45)]"
                style={{ borderRadius: "28px 0 28px 28px" }}
              />
            </div>
          </div>
        </div>
      </section>

      {/* ─────────────────────────────────────────────────────────────
          3) WHO WE'RE LOOKING FOR — full-bleed wine band
          ───────────────────────────────────────────────────────────── */}
      <section className="section" style={{ backgroundColor: WINE }}>
        <div className="container-x">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="display text-4xl text-white sm:text-5xl">
              Who We&apos;re Looking For
            </h2>
            <p className="mt-5 leading-relaxed text-white/80">
              We pride ourselves on the diverse range of experts that make up our
              team. The ideal clinician for our practice is:
            </p>
          </div>

          <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {LOOKING_FOR.map(({ icon: Icon, title, body }) => (
              <div key={title} className="text-center sm:text-left">
                <span
                  className="grid h-12 w-12 place-items-center rounded-full text-white mx-auto sm:mx-0"
                  style={{ backgroundColor: "rgba(225,184,120,0.18)", color: GOLD }}
                >
                  <Icon size={22} aria-hidden />
                </span>
                <h3
                  className="mt-5 font-display text-xl font-semibold"
                  style={{ color: GOLD }}
                >
                  {title}
                </h3>
                <p className="mt-3 text-sm leading-relaxed text-white/85">
                  {body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─────────────────────────────────────────────────────────────
          4) WHY JOIN OUR TEAM? — 2×2 grid on cream, gold CTA
          ───────────────────────────────────────────────────────────── */}
      <section className="section bg-cream-alt">
        <div className="container-x">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="display text-4xl text-ink sm:text-5xl">
              Why Join Our Team?
            </h2>
          </div>

          <div className="mt-14 grid gap-6 sm:grid-cols-2">
            {WHY_JOIN.map(({ icon: Icon, title, body }) => (
              <div key={title} className="flex items-start gap-5">
                <span
                  className="grid h-12 w-12 shrink-0 place-items-center rounded-full text-white"
                  style={{ backgroundColor: WINE }}
                >
                  <Icon size={22} aria-hidden />
                </span>
                <div>
                  <h3 className="font-display text-xl font-semibold text-ink">
                    {title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-ink-muted">
                    {body}
                  </p>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-14 text-center">
            <a
              href={JOTFORM_APPLY}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-primary inline-flex"
            >
              Join our Team <FiArrowRight size={15} aria-hidden />
            </a>
          </div>
        </div>
      </section>

      {/* ─────────────────────────────────────────────────────────────
          5) BOTTOM CTA — centered band
          ───────────────────────────────────────────────────────────── */}
      <section className="section-tight bg-white">
        <div className="container-narrow text-center">
          <h2 className="display text-3xl text-ink sm:text-4xl">
            Ready to begin your healing journey?
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-ink-muted">
            Take the first step on the path toward a brighter tomorrow!
          </p>
          <Link href="/contact" className="btn-primary mt-8 inline-flex">
            Consultation Now <FiArrowRight size={15} aria-hidden />
          </Link>
        </div>
      </section>
    </>
  );
}
