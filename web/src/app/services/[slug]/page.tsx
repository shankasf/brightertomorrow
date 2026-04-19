import Link from "next/link";
import { notFound } from "next/navigation";
import { getServiceBySlug } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function ServiceDetail({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const svc = await getServiceBySlug(slug);
  if (!svc) notFound();
  return (
    <article>
      <section className="bg-hero-gradient">
        <div className="container-x py-10 sm:py-14 lg:py-16 grid lg:grid-cols-2 gap-8 sm:gap-10 lg:gap-12 items-center">
          <div>
            <span className="text-xs uppercase tracking-[0.2em] text-brand font-semibold">Service</span>
            <h1 className="mt-2 text-3xl sm:text-4xl md:text-5xl font-bold text-ink break-words">{svc.title}</h1>
            <p className="mt-4 text-ink-muted text-base sm:text-lg">{svc.short_desc}</p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="/contact" className="btn-primary">Book this service</Link>
              <Link href="/services" className="btn-ghost">All services</Link>
            </div>
          </div>
          {svc.image_url && (
            <div className="relative aspect-[5/4] rounded-3xl overflow-hidden shadow-card">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={svc.image_url} alt={svc.title} className="w-full h-full object-cover" />
            </div>
          )}
        </div>
      </section>
      <section className="section !py-10 sm:!py-14 lg:!py-20">
        <div className="container-x max-w-3xl">
          <p className="text-base sm:text-lg text-ink leading-relaxed break-words">{svc.long_desc}</p>
        </div>
      </section>
    </article>
  );
}
