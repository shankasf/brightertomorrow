import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Reveal from "@/components/Reveal";
import { pageMetadata } from "@/lib/seo";
import { getServiceBySlug } from "@/lib/queries";
import { FiArrowLeft, FiArrowUpRight, FiClock, FiShield, FiStar } from "react-icons/fi";

// DB-driven fallback for service detail pages. Bespoke hand-built pages
// (e.g. services/teletherapy/) take precedence over this dynamic segment.
export const dynamic = "force-dynamic";

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> },
): Promise<Metadata> {
  const { slug } = await params;
  const svc = await getServiceBySlug(slug);
  // Throw here, not just in the page body: metadata resolves before streaming
  // starts, so this is what makes the response a real HTTP 404 (not a soft 200).
  if (!svc) notFound();
  return pageMetadata({
    title: svc.title,
    description:
      svc.short_desc ??
      `${svc.title} at Brighter Tomorrow Therapy Collective in Las Vegas, NV. Compassionate, in-person and online care.`,
    path: `/services/${slug}`,
    ogImage: svc.image_url ?? undefined,
  });
}

export default async function ServiceDetail({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const svc = await getServiceBySlug(slug);
  if (!svc) notFound();

  return (
    <article>
      {/* Page header */}
      <section className="bg-cream-alt relative overflow-hidden">
        <div aria-hidden className="absolute inset-0 bg-grid opacity-[0.06]" />
        <div className="container-x relative py-16 sm:py-20 lg:py-24">
          <Link
            href="/services"
            className="inline-flex items-center gap-2 text-sm text-brand-700 hover:text-brand transition mb-8"
          >
            <FiArrowLeft /> All services
          </Link>
          <div className="grid lg:grid-cols-12 gap-10 lg:gap-14 items-center">
            <Reveal direction="up" className="lg:col-span-7">
              <span className="eyebrow">Service</span>
              <h1 className="mt-5 display text-4xl sm:text-5xl md:text-6xl lg:text-7xl text-ink break-words leading-[1.02]">
                {svc.title}
              </h1>
              <svg aria-hidden viewBox="0 0 200 8" className="mt-6 w-36 h-2 text-brand">
                <path d="M2 5 Q 50 0 100 4 T 198 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
              <p className="mt-6 text-ink-muted text-lg sm:text-xl leading-relaxed">{svc.short_desc}</p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link href="/contact" className="btn-primary">
                  Book this service <FiArrowUpRight />
                </Link>
                <Link href="/services" className="btn-ghost">All services</Link>
              </div>
            </Reveal>
            {svc.image_url && (
              <Reveal direction="right" delay={0.1} className="lg:col-span-5">
                <div className="relative aspect-[5/4] rounded-4xl overflow-hidden shadow-card border border-surface-line">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={svc.image_url} alt={svc.title} className="w-full h-full object-cover" />
                </div>
              </Reveal>
            )}
          </div>
        </div>
      </section>

      {/* Body — main copy + sidebar */}
      <section className="section bg-white">
        <div className="container-x grid lg:grid-cols-12 gap-10 lg:gap-16">
          <Reveal className="lg:col-span-8">
            <div className="text-lg leading-[1.85] text-ink-muted break-words whitespace-pre-line">
              {svc.long_desc}
            </div>
            <div className="mt-12 pt-8 border-t border-surface-line flex flex-wrap gap-3">
              <Link href="/contact" className="btn-primary">
                Get matched <FiArrowUpRight />
              </Link>
              <Link href="/team" className="btn-ghost">Meet our therapists</Link>
            </div>
          </Reveal>

          <Reveal direction="left" delay={0.08} className="lg:col-span-4">
            <div className="sticky top-24 space-y-4">
              <div className="rounded-3xl bg-cream border border-surface-line p-7">
                <span className="eyebrow">At a glance</span>
                <ul className="mt-6 space-y-5">
                  <li className="flex gap-3">
                    <span className="mt-1 w-9 h-9 rounded-full bg-sage-100 text-sage-700 grid place-items-center shrink-0">
                      <FiStar size={15} />
                    </span>
                    <div>
                      <div className="font-display text-base text-ink">What to expect</div>
                      <div className="text-sm text-ink-muted mt-1 leading-relaxed">
                        A warm, collaborative first session to understand your goals and find the right fit.
                      </div>
                    </div>
                  </li>
                  <li className="flex gap-3">
                    <span className="mt-1 w-9 h-9 rounded-full bg-sage-100 text-sage-700 grid place-items-center shrink-0">
                      <FiClock size={15} />
                    </span>
                    <div>
                      <div className="font-display text-base text-ink">How long</div>
                      <div className="text-sm text-ink-muted mt-1 leading-relaxed">
                        Sessions are 50 minutes. Cadence is weekly to biweekly, adjusted to your needs.
                      </div>
                    </div>
                  </li>
                  <li className="flex gap-3">
                    <span className="mt-1 w-9 h-9 rounded-full bg-sage-100 text-sage-700 grid place-items-center shrink-0">
                      <FiShield size={15} />
                    </span>
                    <div>
                      <div className="font-display text-base text-ink">Insurance</div>
                      <div className="text-sm text-ink-muted mt-1 leading-relaxed">
                        Most major Nevada insurance accepted. Sliding-scale options available.
                      </div>
                    </div>
                  </li>
                </ul>
              </div>

              <div className="rounded-3xl bg-cream-deep border border-surface-line p-7">
                <h3 className="font-display text-xl text-ink">Not sure where to start?</h3>
                <p className="text-sm text-ink-muted mt-2 leading-relaxed">
                  Tell us a little about you — we&apos;ll match you to the right clinician.
                </p>
                <Link href="/contact" className="btn-ink mt-5 w-full justify-center">
                  Get matched <FiArrowUpRight />
                </Link>
              </div>
            </div>
          </Reveal>
        </div>
      </section>
    </article>
  );
}
