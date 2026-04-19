import Link from "next/link";
import Hero from "@/components/Hero";
import Reveal from "@/components/Reveal";
import Counter from "@/components/Counter";
import AboutIntro from "@/components/AboutIntro";
import HomeLocations from "@/components/HomeLocations";
import PressMentionSection from "@/components/PressMention";
import AppointmentSection from "@/components/AppointmentSection";
import HomeFaqs from "@/components/HomeFaqs";
import {
  getBlogPosts, getFaqs, getLocations, getPressMentions,
  getServices, getSiteSettings, getStats, getTestimonials,
} from "@/lib/queries";
import { FiArrowRight } from "react-icons/fi";

export default async function HomePage() {
  const [settings, services, stats, testimonials, posts, locations, press, faqs] = await Promise.all([
    getSiteSettings(),
    getServices(),                  // show all 8 in 2x4 like the original
    getStats(),
    getTestimonials(),
    getBlogPosts(3),
    getLocations(),
    getPressMentions(),
    getFaqs(),
  ]);

  return (
    <>
      <Hero settings={settings} />

      {/* About + 4-col stats */}
      <AboutIntro />

      {/* Stats strip */}
      <section className="bg-brand text-white relative overflow-hidden">
        <div className="absolute inset-0 opacity-10 pointer-events-none"
             style={{ backgroundImage: "radial-gradient(circle at 1px 1px, white 1px, transparent 0)", backgroundSize: "24px 24px" }} />
        <div className="container-x grid grid-cols-2 md:grid-cols-4 gap-4 sm:gap-6 py-12 sm:py-14 text-center relative">
          {stats.map((st) => (
            <div key={st.id}>
              <div className="text-3xl sm:text-4xl md:text-5xl font-display font-bold">
                <Counter to={Number(st.value)} suffix={st.suffix ?? ""} />
              </div>
              <div className="text-white/80 text-xs sm:text-sm uppercase tracking-wider mt-1">{st.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Services — 8 cards in a 2x4 grid (matches original homepage) */}
      <section className="section !py-12 sm:!py-16 lg:!py-20">
        <div className="container-x">
          <Reveal>
            <div className="text-center max-w-2xl mx-auto mb-10 sm:mb-12">
              <span className="text-xs uppercase tracking-[0.2em] text-brand font-semibold">What we offer</span>
              <h2 className="mt-2 text-3xl sm:text-4xl font-bold text-ink">Care matched to where you are.</h2>
              <p className="mt-3 text-ink-muted">Therapy designed around your life — individual, couples, family, child &amp; teen, telehealth, and more.</p>
            </div>
          </Reveal>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5 lg:gap-6">
            {services.map((s, i) => (
              <Reveal key={s.id} delay={i * 0.04}>
                <Link href={`/services/${s.slug}`}
                      className="group flex flex-col h-full bg-white rounded-2xl overflow-hidden border border-surface-line hover:border-brand hover:shadow-soft hover:-translate-y-1 transition-all duration-300">
                  {s.image_url && (
                    <div className="aspect-[4/3] overflow-hidden">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={s.image_url} alt={s.title}
                           className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                    </div>
                  )}
                  <div className="p-5 flex-1 flex flex-col">
                    <h3 className="font-display text-base sm:text-lg font-semibold text-ink group-hover:text-brand transition">{s.title}</h3>
                    <p className="text-sm text-ink-muted mt-2 flex-1">{s.short_desc}</p>
                    <span className="text-xs text-brand mt-3 inline-flex items-center gap-1 font-bold uppercase tracking-wider">
                      Read more <FiArrowRight className="group-hover:translate-x-1 transition-transform" />
                    </span>
                  </div>
                </Link>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Locations */}
      <HomeLocations locations={locations} />

      {/* Press mentions */}
      <PressMentionSection mentions={press} />

      {/* Testimonials */}
      <section className="section !py-12 sm:!py-16 lg:!py-20">
        <div className="container-x">
          <Reveal>
            <div className="text-center max-w-2xl mx-auto mb-10 sm:mb-12">
              <span className="text-xs uppercase tracking-[0.2em] text-brand font-semibold">Client voices</span>
              <h2 className="mt-2 text-3xl sm:text-4xl font-bold text-ink">What clients are saying.</h2>
            </div>
          </Reveal>
          <div className="grid sm:grid-cols-2 gap-5 lg:gap-6">
            {testimonials.map((t, i) => (
              <Reveal key={t.id} delay={i * 0.05}>
                <figure className="relative bg-white rounded-2xl border border-surface-line p-6 sm:p-7 shadow-soft hover:shadow-card transition h-full flex flex-col">
                  <span className="absolute -top-5 left-6 w-10 h-10 rounded-full bg-brand text-white grid place-items-center font-serif text-3xl leading-none pb-2">“</span>
                  <div className="text-amber-400 text-base">★★★★★</div>
                  <blockquote className="serif text-base sm:text-lg mt-3 leading-relaxed text-ink flex-1">{t.quote}</blockquote>
                  <figcaption className="flex items-center gap-3 mt-5 pt-5 border-t border-surface-line">
                    <div className="w-10 h-10 rounded-full bg-brand-50 text-brand grid place-items-center font-display font-bold">
                      {initials(t.author)}
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-ink">{t.author}</div>
                      <div className="text-xs text-ink-muted">Verified client</div>
                    </div>
                  </figcaption>
                </figure>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ accordion */}
      <HomeFaqs faqs={faqs} />

      {/* Contact / appointment */}
      <AppointmentSection settings={settings} locations={locations} />

      {/* Blog preview */}
      <section className="section !py-12 sm:!py-16 lg:!py-20">
        <div className="container-x">
          <Reveal>
            <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-8 sm:mb-10">
              <div>
                <span className="text-xs uppercase tracking-[0.2em] text-brand font-semibold">Journal</span>
                <h2 className="mt-2 text-3xl sm:text-4xl font-bold text-ink">From the blog.</h2>
              </div>
              <Link href="/blog" className="btn-ghost shrink-0">View all blog <FiArrowRight /></Link>
            </div>
          </Reveal>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5 lg:gap-6">
            {posts.map((p, i) => (
              <Reveal key={p.id} delay={i * 0.05}>
                <Link href={`/blog/${p.slug}`}
                      className="group flex flex-col h-full bg-white rounded-2xl overflow-hidden border border-surface-line hover:shadow-card hover:-translate-y-1 transition-all duration-300">
                  {p.cover_url && (
                    <div className="aspect-[16/10] overflow-hidden">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={p.cover_url} alt={p.title}
                           className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                    </div>
                  )}
                  <div className="p-5 flex-1 flex flex-col">
                    <div className="text-xs text-ink-muted uppercase tracking-wider">
                      {new Date(p.published_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    </div>
                    <h3 className="font-display text-base sm:text-lg font-semibold mt-1 text-ink group-hover:text-brand transition break-words">{p.title}</h3>
                    <p className="text-sm text-ink-muted mt-2 flex-1">{p.excerpt}</p>
                    <span className="text-xs text-brand mt-3 inline-flex items-center gap-1 font-bold uppercase tracking-wider">
                      Read article <FiArrowRight className="group-hover:translate-x-1 transition-transform" />
                    </span>
                  </div>
                </Link>
              </Reveal>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}

function initials(name: string): string {
  return name.split(/\s+/).map((p) => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
}
