import Link from "next/link";
import Hero from "@/components/Hero";
import Reveal from "@/components/Reveal";
import Counter from "@/components/Counter";
import AboutIntro from "@/components/AboutIntro";
import HomeFeatureRow from "@/components/HomeFeatureRow";
import HomeLocations from "@/components/HomeLocations";
import PressMentionSection from "@/components/PressMention";
import AppointmentSection from "@/components/AppointmentSection";
import HomeFaqs from "@/components/HomeFaqs";
import FirstStepCta from "@/components/FirstStepCta";
import NotSureWhereToStart from "@/components/NotSureWhereToStart";
import FreeResources from "@/components/FreeResources";
import PodcastSection from "@/components/PodcastSection";
import HomeMaps from "@/components/HomeMaps";
import {
  getBlogPosts, getFaqs, getFreeResources, getLocations, getPodcast,
  getPressMentions, getServices, getSiteSettings, getStats, getTestimonials,
} from "@/lib/queries";
import { FiArrowUpRight } from "react-icons/fi";

export default async function HomePage() {
  const [
    settings, services, stats, testimonials, posts, locations, press, faqs,
    podcast, resources,
  ] = await Promise.all([
    getSiteSettings(),
    getServices(),                  // show all 8 in 2x4 like the original
    getStats(),
    getTestimonials(),
    getBlogPosts(3),
    getLocations(),
    getPressMentions(),
    getFaqs(),
    getPodcast(),
    getFreeResources(),
  ]);

  return (
    <>
      <Hero settings={settings} />

      {/* 3-card row: Customer Service / Service Areas / Journal — matches live */}
      <HomeFeatureRow settings={settings} />

      {/* About + 4-col stats */}
      <AboutIntro />

      {/* Stats strip — gold accent on cream (matches live's About-section stats row) */}
      <section className="bg-cream-alt relative overflow-hidden border-y border-surface-line">
        <div className="container-x grid grid-cols-2 md:grid-cols-4 gap-4 sm:gap-6 py-12 sm:py-14 text-center relative">
          {stats.map((st) => (
            <div key={st.id}>
              <div
                className="text-3xl sm:text-4xl md:text-5xl font-display font-bold"
                style={{ color: "#66202A" }}
              >
                <Counter to={Number(st.value)} suffix={st.suffix ?? ""} />
              </div>
              <div
                className="text-xs sm:text-sm uppercase tracking-[0.16em] mt-2 font-semibold"
                style={{ color: "#E1B878" }}
              >
                {st.label}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Services / Specialties — wine band matching live (#66202A) — circle images */}
      <section
        className="section relative overflow-hidden"
        style={{ backgroundColor: "#66202A" }}
      >
        <div className="container-x">
          <Reveal>
            <div className="text-center max-w-2xl mx-auto mb-12 sm:mb-16">
              <span
                className="eyebrow center"
                style={{ color: "#E1B878" }}
              >
                Our Specialities
              </span>
              <h2 className="mt-5 display text-4xl sm:text-5xl md:text-6xl text-white">
                How Our Therapists Can{" "}
                <span className="italic-accent" style={{ color: "#E1B878" }}>
                  Help.
                </span>
              </h2>
              <p
                className="mt-5 text-base sm:text-lg leading-relaxed"
                style={{ color: "rgba(255,255,255,0.85)" }}
              >
                At Brighter Tomorrow, every individual&rsquo;s journey is unique.
                Our collective is designed to meet you inside your story —
                explore our areas of specialty below.
              </p>
            </div>
          </Reveal>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5 lg:gap-8">
            {services.map((s, i) => (
              <Reveal key={s.id} delay={i * 0.04}>
                <Link
                  href={`/services/${s.slug}`}
                  className="group relative flex flex-col h-full items-center text-center px-4 py-6 sm:py-8 hover:-translate-y-1 transition-all duration-500"
                >
                  {s.image_url ? (
                    <div
                      className="relative w-40 sm:w-44 md:w-48 aspect-square rounded-full overflow-hidden ring-4 ring-white/20 group-hover:ring-[#E1B878]/70 transition-all duration-500 shadow-card"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={s.image_url}
                        alt={s.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
                      />
                    </div>
                  ) : (
                    <div className="w-40 sm:w-44 md:w-48 aspect-square rounded-full bg-white/10 ring-4 ring-white/20 grid place-items-center">
                      <span className="font-display text-4xl text-white/70">
                        {s.title.slice(0, 1)}
                      </span>
                    </div>
                  )}

                  <span
                    className="mt-6 text-[11px] font-semibold uppercase tracking-[0.18em] tabular"
                    style={{ color: "#E1B878" }}
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
                    style={{ color: "#E1B878" }}
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

      {/* Not sure where to start — matching tool CTA */}
      <NotSureWhereToStart />

      {/* Locations */}
      <HomeLocations locations={locations} />

      {/* Press mentions / Featured In (enlarged editorial layout) */}
      <PressMentionSection mentions={press} />

      {/* Testimonials — editorial 2-up */}
      <section className="section bg-cream-alt relative overflow-hidden">
        <div className="container-x">
          <Reveal>
            <div className="text-center max-w-2xl mx-auto mb-14">
              <span className="eyebrow center">Client voices</span>
              <h2 className="mt-5 display text-4xl sm:text-5xl md:text-6xl text-ink">
                What clients are <span className="italic-accent">saying.</span>
              </h2>
            </div>
          </Reveal>
          <div className="grid md:grid-cols-2 gap-6 lg:gap-8">
            {testimonials.map((t, i) => (
              <Reveal key={t.id} delay={i * 0.06}>
                <figure className="relative bg-white rounded-4xl border border-surface-line p-8 sm:p-10 lg:p-12 h-full flex flex-col shadow-soft hover:shadow-card transition-all duration-500">
                  <span
                    aria-hidden
                    className="absolute -top-4 left-8 sm:left-12 font-display text-7xl sm:text-8xl text-brand leading-none select-none"
                    style={{ fontStyle: "italic" }}
                  >
                    “
                  </span>
                  <div className="text-amber-400 text-base mt-4">★★★★★</div>
                  <blockquote className="font-display italic text-2xl sm:text-3xl mt-5 leading-[1.35] text-ink flex-1 tracking-tight">
                    {t.quote}
                  </blockquote>
                  <figcaption className="flex items-center gap-4 mt-8 pt-6 border-t border-surface-line">
                    <div className="w-12 h-12 rounded-full bg-sage-100 text-sage-700 grid place-items-center font-display font-semibold text-base">
                      {initials(t.author)}
                    </div>
                    <div>
                      <div className="font-display text-base text-ink">{t.author}</div>
                      <div className="text-xs text-ink-soft uppercase tracking-[0.18em] mt-0.5">Verified client</div>
                    </div>
                  </figcaption>
                </figure>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* "First Step Is Choosing to Take It." gray CTA — matches live */}
      <FirstStepCta />

      {/* FAQ accordion */}
      <HomeFaqs faqs={faqs} />

      {/* Contact / appointment */}
      <AppointmentSection settings={settings} locations={locations} />

      {/* Free resources */}
      <FreeResources resources={resources} />

      {/* Podcast */}
      <PodcastSection podcast={podcast} />

      {/* Blog preview — wine band matching live */}
      <section
        className="section relative overflow-hidden"
        style={{ backgroundColor: "#66202A" }}
      >
        <div className="container-x">
          <Reveal>
            <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6 mb-12">
              <div>
                <span className="eyebrow" style={{ color: "#E1B878" }}>
                  Our Blog
                </span>
                <h2 className="mt-4 display text-4xl sm:text-5xl md:text-6xl text-white">
                  Blog &amp;{" "}
                  <span className="italic-accent" style={{ color: "#E1B878" }}>
                    Articles.
                  </span>
                </h2>
              </div>
              <Link
                href="/blog"
                className="inline-flex items-center gap-2 text-white border border-white/40 hover:bg-white hover:text-ink px-6 py-3.5 font-semibold uppercase tracking-[0.12em] text-[0.78rem] transition shrink-0"
                style={{ borderRadius: "20px 0 20px 20px" }}
              >
                View all articles <FiArrowUpRight />
              </Link>
            </div>
          </Reveal>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8">
            {posts.map((p, i) => (
              <Reveal key={p.id} delay={i * 0.06}>
                <Link
                  href={`/blog/${p.slug}`}
                  className="group flex flex-col h-full overflow-hidden"
                  style={{
                    backgroundColor: "#F4F4F4",
                    borderRadius: "20px 0 20px 20px",
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
                    <div
                      className="text-[10px] font-semibold uppercase tracking-[0.18em]"
                      style={{ color: "#E1B878" }}
                    >
                      {new Date(p.published_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    </div>
                    <h3 className="mt-3 font-display text-xl text-ink break-words leading-snug">
                      {p.title}
                    </h3>
                    <p className="text-sm text-ink-soft mt-3 flex-1 leading-relaxed">{p.excerpt}</p>
                    <span
                      className="mt-5 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em]"
                      style={{ color: "#66202A" }}
                    >
                      Read article
                      <FiArrowUpRight className="transition-transform duration-300 group-hover:translate-x-1 group-hover:-translate-y-0.5" />
                    </span>
                  </div>
                </Link>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Google Maps — both physical offices */}
      <HomeMaps />
    </>
  );
}

function initials(name: string): string {
  return name.split(/\s+/).map((p) => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
}
