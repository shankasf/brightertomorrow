import Reveal from "@/components/Reveal";
import Link from "next/link";
import { getSpecialties } from "@/lib/queries";
import { FiArrowUpRight } from "react-icons/fi";

export const metadata = { title: "Specialties — Brighter Tomorrow Therapy" };

export default async function SpecialtiesPage() {
  const items = await getSpecialties();
  return (
    <>
      {/* Page header */}
      <section className="bg-cream-alt relative overflow-hidden">
        <div aria-hidden className="absolute inset-0 bg-grid opacity-[0.06]" />
        <div className="container-narrow relative py-20 sm:py-28 lg:py-32 text-center">
          <span className="eyebrow center">Specialties</span>
          <h1 className="mt-6 display text-5xl sm:text-6xl lg:text-7xl text-ink">
            Who we <span className="italic-accent">work with.</span>
          </h1>
          <svg aria-hidden viewBox="0 0 200 8" className="mx-auto mt-7 w-36 h-2 text-brand">
            <path d="M2 5 Q 50 0 100 4 T 198 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <p className="mt-7 text-ink-muted text-lg sm:text-xl leading-relaxed max-w-2xl mx-auto">
            Areas of focus across our collective — find what fits, and we&apos;ll match you to the right clinician.
          </p>
        </div>
      </section>

      {/* Editorial list */}
      <section className="section bg-white">
        <div className="container-x">
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5 lg:gap-6">
            {items.map((sp, i) => (
              <Reveal key={sp.id} delay={i * 0.03}>
                <Link
                  href={`/specialties/${sp.slug}`}
                  id={sp.slug}
                  className="group h-full block bg-cream rounded-3xl border border-surface-line p-7 hover:border-brand-700 hover:-translate-y-1 transition-all duration-500 shadow-soft hover:shadow-card"
                >
                  <span className="font-display text-brand-300 text-sm tracking-wider tabular">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <h3 className="mt-2 font-display text-2xl text-ink leading-snug group-hover:text-brand-700 transition-colors">
                    {sp.title}
                  </h3>
                  <p className="text-sm text-ink-muted mt-3 leading-relaxed">{sp.short_desc}</p>
                  <span className="mt-5 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-brand-700">
                    Learn more
                    <FiArrowUpRight className="transition-transform duration-300 group-hover:translate-x-1 group-hover:-translate-y-0.5" />
                  </span>
                </Link>
              </Reveal>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
