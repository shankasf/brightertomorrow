import Link from "next/link";
import Reveal from "@/components/Reveal";
import { getServices } from "@/lib/queries";

export const metadata = { title: "Services — Brighter Tomorrow Therapy" };

export default async function ServicesPage() {
  const services = await getServices();
  return (
    <>
      <section className="bg-hero-gradient">
        <div className="container-x py-10 sm:py-14 lg:py-16 text-center">
          <span className="text-xs uppercase tracking-[0.2em] text-brand font-semibold">Services</span>
          <h1 className="mt-2 text-3xl sm:text-4xl md:text-5xl font-bold text-ink">Care designed around your life.</h1>
          <p className="mt-4 text-ink-muted max-w-2xl mx-auto">Browse our therapy services and find what fits — we'll help you take it from there.</p>
        </div>
      </section>
      <section className="section !py-10 sm:!py-14 lg:!py-20">
        <div className="container-x grid sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5 lg:gap-6">
          {services.map((s, i) => (
            <Reveal key={s.id} delay={i * 0.04}>
              <Link href={`/services/${s.slug}`} className="group block bg-white rounded-2xl overflow-hidden border border-surface-line hover:border-brand hover:shadow-soft transition-all">
                {s.image_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={s.image_url} alt={s.title} className="w-full aspect-[4/3] object-cover group-hover:scale-105 transition-transform duration-500" />
                )}
                <div className="p-5">
                  <h3 className="font-display text-xl font-semibold text-ink group-hover:text-brand transition">{s.title}</h3>
                  <p className="text-sm text-ink-muted mt-2">{s.short_desc}</p>
                </div>
              </Link>
            </Reveal>
          ))}
        </div>
      </section>
    </>
  );
}
