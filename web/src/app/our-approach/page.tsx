import Link from "next/link";
import Reveal from "@/components/Reveal";
import {
  FiUser,
  FiUsers,
  FiHeart,
  FiVideo,
  FiActivity,
  FiCloudRain,
  FiArrowUpRight,
} from "react-icons/fi";
import type { IconType } from "react-icons";

export const metadata = {
  title: "Our Approach — Brighter Tomorrow Therapy",
};

type Service = {
  title: string;
  body: string;
  Icon: IconType;
};

const SERVICES: Service[] = [
  {
    title: "Individual Therapy",
    body: "A tailor-made recovery experience where you can connect with an attentive therapist to overcome doubts, negative thought patterns, and unique challenges.",
    Icon: FiUser,
  },
  {
    title: "Group Therapy",
    body: "Immerse yourself in a supportive community that aids in your recovery process, helping you overcome the stigma associated with mental health concerns.",
    Icon: FiUsers,
  },
  {
    title: "Couples Counseling",
    body: "Build healthier relationships based on trust, communication, and compromise, removing barriers that hinder your interactions.",
    Icon: FiHeart,
  },
  {
    title: "Teletherapy",
    body: "Quality mental health support is just a click away, eliminating geographical barriers and providing a convenient alternative to traditional in-person sessions.",
    Icon: FiVideo,
  },
  {
    title: "Parts & Memory Therapy",
    body: "Utilize your body's innate healing abilities to uncover blocked memories and gain insights into your current self through past experiences.",
    Icon: FiActivity,
  },
  {
    title: "Grief Counseling",
    body: "A significant loss can feel overwhelming, isolating, and impossible to navigate alone. We offer grief counseling to help you process the loss of a loved one, manage difficult emotions, and find a path forward.",
    Icon: FiCloudRain,
  },
];

const SPECIALTIES: string[] = [
  "Trauma",
  "Anxiety",
  "Depression",
  "Addiction",
  "Relationship Challenges",
  "Other Mental Health Concerns",
];

export default function OurApproachPage() {
  return (
    <>
      {/* Page header */}
      <section className="bg-cream-alt relative overflow-hidden">
        <div aria-hidden className="absolute inset-0 bg-grid opacity-[0.06]" />
        <div className="container-narrow relative py-20 sm:py-28 lg:py-32 text-center">
          <span className="eyebrow center">Our Approach</span>
          <h1 className="mt-6 display text-5xl sm:text-6xl lg:text-7xl text-ink">
            Therapy that&apos;s{" "}
            <span className="italic-accent">tailored to you.</span>
          </h1>
          <svg
            aria-hidden
            viewBox="0 0 200 8"
            className="mx-auto mt-7 w-36 h-2 text-brand"
          >
            <path
              d="M2 5 Q 50 0 100 4 T 198 5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
          <p className="mt-7 text-ink-muted text-lg sm:text-xl leading-relaxed max-w-2xl mx-auto">
            Our holistic approach is tailored to your unique experiences,
            ensuring that you feel understood, supported, and empowered
            throughout your healing journey.
          </p>
        </div>
      </section>

      {/* Mission */}
      <section className="section bg-white">
        <div className="container-narrow text-center">
          <Reveal>
            <span className="eyebrow center">Our Mission</span>
            <p className="mt-8 font-display text-3xl sm:text-4xl lg:text-5xl text-ink leading-[1.2] tracking-tight">
              To make therapy and counseling{" "}
              <span className="italic-accent">accessible to everyone,</span>{" "}
              regardless of age or background.
            </p>
            <p className="mt-8 text-ink-muted text-lg leading-relaxed max-w-xl mx-auto">
              We believe that everyone deserves a brighter future, and our name
              encapsulates our commitment to guiding you toward a brighter
              tomorrow.
            </p>
          </Reveal>
        </div>
      </section>

      {/* Services — 6 cards */}
      <section className="section bg-cream">
        <div className="container-x">
          <Reveal>
            <div className="text-center max-w-2xl mx-auto mb-14">
              <span className="eyebrow center">How we help</span>
              <h2 className="mt-5 display text-4xl sm:text-5xl text-ink">
                How our therapists in Las Vegas, NV,{" "}
                <span className="italic-accent">can help.</span>
              </h2>
            </div>
          </Reveal>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8">
            {SERVICES.map((s, i) => {
              const Icon = s.Icon;
              return (
                <Reveal key={s.title} delay={i * 0.05}>
                  <article className="h-full bg-white rounded-3xl border border-surface-line p-8 lg:p-10 shadow-soft hover:shadow-card hover:border-brand transition-all duration-500">
                    <span className="inline-flex w-12 h-12 items-center justify-center rounded-full bg-sage-100 text-sage-700">
                      <Icon size={22} />
                    </span>
                    <h3 className="mt-6 font-display text-2xl text-ink leading-tight">
                      {s.title}
                    </h3>
                    <p className="mt-4 text-ink-muted leading-relaxed">
                      {s.body}
                    </p>
                  </article>
                </Reveal>
              );
            })}
          </div>
        </div>
      </section>

      {/* Specialties */}
      <section className="section bg-white">
        <div className="container-narrow text-center">
          <Reveal>
            <span className="eyebrow center">Our Specialties</span>
            <h2 className="mt-5 display text-4xl sm:text-5xl text-ink">
              Expertise that meets you{" "}
              <span className="italic-accent">where you are.</span>
            </h2>
            <p className="mt-7 text-ink-muted text-lg leading-relaxed max-w-2xl mx-auto">
              Our team of seasoned therapists brings a diverse range of
              expertise. We ensure that each client&apos;s therapy journey is
              unique by matching them with therapists who truly understand
              their struggles.
            </p>
          </Reveal>

          <Reveal delay={0.08}>
            <ul className="mt-10 flex flex-wrap justify-center gap-2 sm:gap-3">
              {SPECIALTIES.map((label) => (
                <li key={label}>
                  <span className="inline-flex items-center rounded-full border border-surface-line bg-cream-alt px-4 py-2 text-sm font-medium text-ink">
                    {label}
                  </span>
                </li>
              ))}
            </ul>
          </Reveal>

          <Reveal delay={0.12}>
            <p className="mt-10 text-ink-muted text-lg leading-relaxed max-w-xl mx-auto">
              Our specialists are equipped to provide personalized care that
              addresses your specific needs.
            </p>
          </Reveal>
        </div>
      </section>

      {/* Closing CTA — brand wine */}
      <section className="bg-brand-700 text-white">
        <div className="container-narrow py-20 sm:py-24 text-center">
          <Reveal>
            <span
              className="eyebrow center"
              style={{ color: "var(--brand)" }}
            >
              Get started
            </span>
            <h2 className="mt-5 display text-4xl sm:text-5xl lg:text-6xl text-white">
              Ready to begin your{" "}
              <span
                className="italic-accent"
                style={{ color: "var(--brand)" }}
              >
                healing journey?
              </span>
            </h2>
            <p className="mt-6 text-white/85 text-lg leading-relaxed max-w-xl mx-auto">
              Take the first step on the path toward a brighter tomorrow!
            </p>
            <div className="mt-9 flex flex-wrap justify-center gap-3">
              <Link href="/contact" className="btn-primary">
                Get matched <FiArrowUpRight />
              </Link>
              <Link
                href="/team"
                className="btn-ghost"
                style={{ color: "#F4F4F4" }}
              >
                Meet the team
              </Link>
            </div>
          </Reveal>
        </div>
      </section>
    </>
  );
}
