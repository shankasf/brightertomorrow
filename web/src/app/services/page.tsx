import Link from "next/link";
import Reveal from "@/components/Reveal";
import { getServices } from "@/lib/queries";
import { FiArrowUpRight } from "react-icons/fi";

export const metadata = { title: "Services — Brighter Tomorrow Therapy" };

export default async function ServicesPage() {
  const services = await getServices();
  return (
    <>
      {/* Page header */}
      <section className="bg-cream-alt relative overflow-hidden">
        <div aria-hidden className="absolute inset-0 bg-grid opacity-[0.06]" />
        <div className="container-narrow relative py-20 sm:py-28 lg:py-32 text-center">
          <span className="eyebrow center">Services</span>
          <h1 className="mt-6 display text-5xl sm:text-6xl lg:text-7xl text-ink">
            Care designed around <span className="italic-accent">your life.</span>
          </h1>
          <svg aria-hidden viewBox="0 0 200 8" className="mx-auto mt-7 w-36 h-2 text-brand">
            <path d="M2 5 Q 50 0 100 4 T 198 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <p className="mt-7 text-ink-muted text-lg sm:text-xl leading-relaxed max-w-2xl mx-auto">
            Browse our therapy services and find what fits — we&apos;ll help you take it from there.
          </p>
        </div>
      </section>

      {/* Editorial 2-column alternating list */}
      <section className="section bg-white">
        <div className="container-x">
          <ul className="space-y-16 sm:space-y-24 lg:space-y-28">
            {services.map((s, i) => {
              const reverse = i % 2 === 1;
              return (
                <li key={s.id}>
                  <Reveal>
                    <Link
                      href={`/services/${s.slug}`}
                      className={`group grid lg:grid-cols-12 gap-8 lg:gap-12 items-center ${reverse ? "lg:[direction:rtl]" : ""}`}
                    >
                      <div className={`lg:col-span-7 [direction:ltr] flex justify-center`}>
                        {s.image_url && (
                          <div className="relative overflow-hidden rounded-full border border-surface-line aspect-square w-full max-w-[28rem] sm:max-w-[32rem] lg:max-w-[36rem] bg-cream-alt">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={s.image_url}
                              alt={s.title}
                              className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-700"
                            />
                          </div>
                        )}
                      </div>
                      <div className="lg:col-span-5 [direction:ltr]">
                        <span className="font-display text-brand-300 text-sm tracking-wider tabular">
                          {String(i + 1).padStart(2, "0")} / {String(services.length).padStart(2, "0")}
                        </span>
                        <h2 className="mt-3 display text-4xl sm:text-5xl text-ink leading-[1.05] group-hover:text-brand-700 transition-colors">
                          {s.title}
                        </h2>
                        <p className="mt-5 text-ink-muted text-lg leading-relaxed">{s.short_desc}</p>
                        <span className="mt-7 inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.18em] text-brand-700 border-b border-brand-700/30 pb-1 group-hover:border-brand-700 transition">
                          Learn more
                          <FiArrowUpRight className="transition-transform duration-300 group-hover:translate-x-1 group-hover:-translate-y-0.5" />
                        </span>
                      </div>
                    </Link>
                  </Reveal>
                </li>
              );
            })}
          </ul>
        </div>
      </section>
    </>
  );
}
