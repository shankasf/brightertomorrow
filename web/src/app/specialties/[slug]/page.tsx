import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getSpecialtyBySlug } from "@/lib/queries";
import { FiArrowLeft, FiClock, FiShield, FiStar } from "react-icons/fi";
import MatchTrigger from "./MatchTrigger";

export const dynamic = "force-dynamic";

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> },
): Promise<Metadata> {
  const { slug } = await params;
  const sp = await getSpecialtyBySlug(slug);
  if (!sp) return { title: "Specialty — Brighter Tomorrow Therapy" };
  return {
    title: `${sp.title} — Brighter Tomorrow Therapy`,
    description: sp.short_desc ?? undefined,
  };
}

export default async function SpecialtyDetail({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const sp = await getSpecialtyBySlug(slug);
  if (!sp) notFound();

  return (
    <article>
      {/* Page header */}
      <section className="bg-cream-alt relative overflow-hidden">
        <div aria-hidden className="absolute inset-0 bg-grid opacity-[0.06]" />
        <div className="container-x relative py-16 sm:py-20 lg:py-24">
          <Link
            href="/specialties"
            className="inline-flex items-center gap-2 text-sm text-brand-700 hover:text-brand transition mb-8"
          >
            <FiArrowLeft /> All specialties
          </Link>
          <div className="grid lg:grid-cols-12 gap-10 lg:gap-14 items-center">
            <div className={sp.image_url ? "lg:col-span-7" : "lg:col-span-12"}>
              <span className="eyebrow">Specialty</span>
              <h1 className="mt-5 display text-5xl sm:text-6xl lg:text-7xl text-ink break-words leading-[1.02]">
                {sp.title}
              </h1>
              <svg aria-hidden viewBox="0 0 200 8" className="mt-6 w-36 h-2 text-brand">
                <path d="M2 5 Q 50 0 100 4 T 198 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
              {sp.short_desc && (
                <p className="mt-6 text-ink-muted text-lg sm:text-xl leading-relaxed">{sp.short_desc}</p>
              )}
              <div className="mt-8 flex flex-wrap gap-3">
                <MatchTrigger label="Get matched" className="btn-primary" />
                <Link href="/specialties" className="btn-ghost">All specialties</Link>
              </div>
            </div>
            {sp.image_url && (
              <div className="lg:col-span-5">
                <div className="relative aspect-[5/4] rounded-4xl overflow-hidden shadow-card border border-surface-line">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={sp.image_url} alt={sp.title} className="w-full h-full object-cover" />
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Body — main copy + sidebar */}
      <section className="section bg-white">
        <div className="container-x grid lg:grid-cols-12 gap-10 lg:gap-16">
          <div className="lg:col-span-8">
            {sp.long_desc ? (
              <div className="text-lg leading-[1.85] text-ink-muted break-words whitespace-pre-line">
                {sp.long_desc}
              </div>
            ) : (
              <p className="text-lg leading-relaxed text-ink-muted">
                {sp.short_desc}
              </p>
            )}
            <div className="mt-12 pt-8 border-t border-surface-line flex flex-wrap gap-3">
              <MatchTrigger label="Get matched" className="btn-primary" />
              <Link href="/team" className="btn-ghost">Meet our therapists</Link>
            </div>
          </div>

          <aside className="lg:col-span-4">
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
                <MatchTrigger />
              </div>
            </div>
          </aside>
        </div>
      </section>
    </article>
  );
}
