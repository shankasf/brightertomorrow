import Link from "next/link";
import Hero from "@/components/Hero";
import Reveal from "@/components/Reveal";
import Counter from "@/components/Counter";
import AboutIntro from "@/components/AboutIntro";
import HomeFeatureRow from "@/components/HomeFeatureRow";
import HomeLocations from "@/components/HomeLocations";
import AppointmentSection from "@/components/AppointmentSection";
import HomeFaqs from "@/components/HomeFaqs";
import FirstStepCta from "@/components/FirstStepCta";
import PodcastSection from "@/components/PodcastSection";
import { JsonLd, homepageGraph } from "@/components/StructuredData";
import {
  getBlogPosts,
  getFaqs,
  getLocations,
  getPodcast,
  getServices,
  getSiteSettings,
  getStats,
} from "@/lib/queries";
import { FiArrowUpRight } from "react-icons/fi";
import { pageMetadata } from "@/lib/seo";

/**
 * Cloud homepage — pixel-parity mirror of brightertomorrowtherapy.com home.
 *
 * Section order (matches .com):
 *   1.  Hero (slideshow + headline + CTAs)
 *   2.  3-card row  (Customer Service / Service Areas / Journal)
 *   3.  About + Licensed Specialists / Holistic Approach
 *   4.  Stats strip (Years / Patients / Mental Healing / Therapists)
 *   5.  Specialties wine band (circle thumbs)
 *   6.  Two Locations wine band
 *   7.  First Step CTA (gray photo)
 *   8.  Have Questions? — FAQ accordion
 *   9.  Appointment (form + info)
 *  10.  Podcast wine band
 *  11.  Blog wine band
 *
 * Header + footer are handled in app/layout.tsx.
 */

const WINE = "#66202A";
const GOLD = "#E1B878";
const INK = "#192735";

export const metadata = pageMetadata({
  title: "Therapy in Las Vegas, NV",
  description:
    "Compassionate therapy in Las Vegas and North Las Vegas for children, teens, and adults. In-person and online, with evening and weekend availability. Most major Nevada insurance accepted.",
  path: "/",
});

export default async function HomePage() {
  const [settings, services, stats, posts, locations, podcast, faqs] =
    await Promise.all([
      getSiteSettings(),
      getServices(), // show all in the specialties grid
      getStats(),
      getBlogPosts(3),
      getLocations(),
      getPodcast(),
      getFaqs(),
    ]);

  // Only show first 5 FAQs on the homepage (matches .com home preview).
  const homeFaqs = faqs.slice(0, 5);

  return (
    <>
      {/* Structured data: MedicalBusiness/LocalBusiness (+ two clinic
          departments) and WebSite, as one @graph. Invisible to users. */}
      <JsonLd data={homepageGraph()} />

      {/* 1. HERO */}
      <Hero settings={settings} />

      {/* 2. 3-card row */}
      <HomeFeatureRow settings={settings} />

      {/* 3. About + features */}
      <AboutIntro />

      {/* 4. Stats strip — wine band exactly like .com */}
      <section
        className="relative overflow-hidden"
        style={{
          backgroundImage:
            "linear-gradient(rgba(102,32,42,0.85), rgba(102,32,42,0.9)), url('/images/home/about-bg.jpg')",
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      >
        <div className="container-x grid grid-cols-2 md:grid-cols-4 gap-6 sm:gap-8 py-16 sm:py-20 text-center">
          {stats.map((st) => (
            <Reveal key={st.id} direction="up">
              <div
                className="text-4xl sm:text-5xl md:text-6xl font-display font-bold"
                style={{ color: GOLD }}
              >
                <Counter to={Number(st.value)} suffix={st.suffix ?? ""} />
              </div>
              <div className="text-xs sm:text-sm uppercase tracking-[0.18em] mt-3 font-semibold text-white/90">
                {st.label}
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* 5. Specialties — wine band w/ circle thumbs */}
      <section
        className="section relative overflow-hidden"
        style={{ backgroundColor: WINE }}
      >
        <div className="container-x">
          <Reveal>
            <div className="text-center max-w-3xl mx-auto mb-12 sm:mb-16">
              <p
                className="font-script italic text-[20px] sm:text-[24px]"
                style={{ color: GOLD }}
              >
                Our Specialities
              </p>
              <h2 className="mt-3 font-display font-bold text-[32px] sm:text-[40px] lg:text-[45px] text-white leading-[1.15]">
                How Our Therapists in Las Vegas and North Las Vegas, NV, Can
                Help
              </h2>
              <p
                className="mt-5 text-base sm:text-lg leading-relaxed"
                style={{ color: "rgba(255,255,255,0.85)" }}
              >
                At Brighter Tomorrow, we understand that every
                individual&rsquo;s journey is unique.
              </p>
            </div>
          </Reveal>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6 lg:gap-8">
            {services.map((s, i) => (
              <Reveal key={s.id} delay={i * 0.04}>
                <Link
                  href={`/services/${s.slug}`}
                  className="group relative flex flex-col h-full items-center text-center px-4 py-6 sm:py-8 hover:-translate-y-1 transition-all duration-500"
                >
                  {s.image_url ? (
                    <div className="relative w-40 sm:w-44 md:w-48 aspect-square rounded-full overflow-hidden ring-4 ring-white/15 group-hover:ring-[color:#E1B878]/70 transition-all duration-500 shadow-card">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={s.image_url}
                        alt={s.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
                      />
                    </div>
                  ) : (
                    <div className="w-40 sm:w-44 md:w-48 aspect-square rounded-full bg-white/10 ring-4 ring-white/15 grid place-items-center">
                      <span className="font-display text-4xl text-white/70">
                        {s.title.slice(0, 1)}
                      </span>
                    </div>
                  )}

                  <span
                    className="mt-6 text-[11px] font-semibold uppercase tracking-[0.18em] tabular"
                    style={{ color: GOLD }}
                  >
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <h3 className="mt-2 font-display text-xl sm:text-[1.3rem] text-white leading-snug">
                    {s.title}
                  </h3>
                  {s.short_desc && (
                    <p
                      className="text-sm mt-3 leading-relaxed max-w-[20rem]"
                      style={{ color: "rgba(255,255,255,0.82)" }}
                    >
                      {s.short_desc}
                    </p>
                  )}
                  <span
                    className="mt-5 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em]"
                    style={{ color: GOLD }}
                  >
                    Read more
                    <FiArrowUpRight className="transition-transform duration-300 group-hover:translate-x-1 group-hover:-translate-y-0.5" />
                  </span>
                </Link>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* 6. Two Locations — wine band */}
      <HomeLocations locations={locations} />

      {/* 7. First Step CTA — gray photo */}
      <FirstStepCta />

      {/* 8. Have Questions? — FAQ accordion (gold-italic eyebrow like .com) */}
      <section className="section bg-white">
        <div className="container-narrow text-center mb-12 sm:mb-14">
          <Reveal>
            <p
              className="font-script italic text-[20px] sm:text-[24px]"
              style={{ color: GOLD }}
            >
              Have Questions?
            </p>
            <h2
              className="mt-3 font-display font-bold text-[32px] sm:text-[40px] lg:text-[45px] leading-[1.15]"
              style={{ color: INK }}
            >
              Frequently Asked Questions
            </h2>
          </Reveal>
        </div>
        <HomeFaqs faqs={homeFaqs} />
      </section>

      {/* 9. Appointment */}
      <AppointmentSection settings={settings} locations={locations} />

      {/* 10. Podcast wine band */}
      <PodcastSection podcast={podcast} />

      {/* 11. Blog wine band */}
      <section
        className="section relative overflow-hidden"
        style={{ backgroundColor: WINE }}
      >
        <div className="container-x">
          <Reveal>
            <div className="text-center max-w-2xl mx-auto mb-12">
              <p
                className="font-script italic text-[20px] sm:text-[24px]"
                style={{ color: GOLD }}
              >
                Our Blog
              </p>
              <h2 className="mt-3 font-display font-bold text-[32px] sm:text-[40px] lg:text-[45px] text-white leading-[1.15]">
                Highlighting Thoughtful Reflections and Expert Insights for
                Mental Well-Being
              </h2>
            </div>
          </Reveal>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8">
            {posts.map((p, i) => (
              <Reveal key={p.id} delay={i * 0.06}>
                <Link
                  href={`/blog/${p.slug}`}
                  className="group flex flex-col h-full overflow-hidden transition hover:-translate-y-1 duration-500"
                  style={{
                    backgroundColor: "rgba(255,255,255,0.04)",
                    border: "1px solid rgba(225,184,120,0.25)",
                    borderRadius: "30px 0 30px 30px",
                  }}
                >
                  {p.cover_url && (
                    <div className="aspect-[4/3] overflow-hidden">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={p.cover_url}
                        alt={p.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
                      />
                    </div>
                  )}
                  <div className="p-6 flex-1 flex flex-col">
                    <h3 className="font-display text-lg sm:text-xl text-white break-words leading-snug">
                      {p.title}
                    </h3>
                    <div
                      className="mt-3 text-[11px] font-semibold uppercase tracking-[0.18em]"
                      style={{ color: GOLD }}
                    >
                      Brighter Tomorrow ·{" "}
                      {new Date(p.published_at).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </div>
                    <p className="text-sm text-white/80 mt-4 flex-1 leading-relaxed">
                      {p.excerpt}
                    </p>
                    <span
                      className="mt-5 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em]"
                      style={{ color: GOLD }}
                    >
                      Read more
                      <FiArrowUpRight className="transition-transform duration-300 group-hover:translate-x-1 group-hover:-translate-y-0.5" />
                    </span>
                  </div>
                </Link>
              </Reveal>
            ))}
          </div>

          <Reveal delay={0.15}>
            <div className="mt-12 flex justify-center">
              <Link
                href="/blog"
                className="inline-block font-display font-bold tracking-[0.15em] text-[13px] uppercase px-8 py-4 transition hover:opacity-90"
                style={{
                  backgroundColor: GOLD,
                  color: INK,
                  borderRadius: "30px 0 30px 30px",
                }}
              >
                View All Blog
              </Link>
            </div>
          </Reveal>
        </div>
      </section>
    </>
  );
}
