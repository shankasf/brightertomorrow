import Reveal from "@/components/Reveal";
import { getSpecialties } from "@/lib/queries";

export const metadata = { title: "Specialties — Brighter Tomorrow Therapy" };

export default async function SpecialtiesPage() {
  const items = await getSpecialties();
  return (
    <>
      <section className="bg-hero-gradient">
        <div className="container-x py-10 sm:py-14 lg:py-16 text-center">
          <span className="text-xs uppercase tracking-[0.2em] text-brand font-semibold">Specialties</span>
          <h1 className="mt-2 text-3xl sm:text-4xl md:text-5xl font-bold text-ink">Who we work with.</h1>
        </div>
      </section>
      <section className="section !py-10 sm:!py-14 lg:!py-20">
        <div className="container-x grid sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5 lg:gap-6">
          {items.map((sp, i) => (
            <Reveal key={sp.id} delay={i * 0.03}>
              <div id={sp.slug} className="bg-white border border-surface-line rounded-2xl p-6 hover:border-brand hover:shadow-soft transition">
                <h3 className="font-display text-xl font-semibold text-ink">{sp.title}</h3>
                <p className="text-sm text-ink-muted mt-2">{sp.short_desc}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>
    </>
  );
}
