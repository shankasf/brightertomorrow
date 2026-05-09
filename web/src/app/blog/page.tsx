import Link from "next/link";
import Reveal from "@/components/Reveal";
import { getBlogPosts } from "@/lib/queries";
import { FiArrowUpRight } from "react-icons/fi";

export const metadata = { title: "Blog — Brighter Tomorrow Therapy" };

export default async function BlogIndex() {
  const posts = await getBlogPosts();
  return (
    <>
      {/* Page header */}
      <section className="bg-cream-alt relative overflow-hidden">
        <div aria-hidden className="absolute inset-0 bg-grid opacity-[0.06]" />
        <div className="container-narrow relative py-20 sm:py-28 lg:py-32 text-center">
          <span className="eyebrow center">Journal</span>
          <h1 className="mt-6 display text-5xl sm:text-6xl lg:text-7xl text-ink">
            From the <span className="italic-accent">blog.</span>
          </h1>
          <svg aria-hidden viewBox="0 0 200 8" className="mx-auto mt-7 w-36 h-2 text-brand">
            <path d="M2 5 Q 50 0 100 4 T 198 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <p className="mt-7 text-ink-muted text-lg sm:text-xl leading-relaxed max-w-2xl mx-auto">
            Notes from our clinicians on therapy, mental health, and the everyday work of becoming.
          </p>
        </div>
      </section>

      {/* Editorial 2-column grid */}
      <section className="section bg-white">
        <div className="container-x">
          <div className="grid md:grid-cols-2 gap-x-10 gap-y-16 lg:gap-x-14 lg:gap-y-20">
            {posts.map((p, i) => (
              <Reveal key={p.id} delay={i * 0.05}>
                <Link href={`/blog/${p.slug}`} className="group flex flex-col h-full">
                  {p.cover_url && (
                    <div className="aspect-[16/10] overflow-hidden rounded-3xl border border-surface-line">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={p.cover_url}
                        alt={p.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
                      />
                    </div>
                  )}
                  <div className="pt-7 flex-1 flex flex-col">
                    <div className="eyebrow-bare text-brand-700 text-[11px]">
                      {new Date(p.published_at).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </div>
                    <h2 className="mt-4 font-display text-3xl sm:text-[2rem] text-ink leading-[1.15] group-hover:text-brand-700 transition-colors break-words">
                      {p.title}
                    </h2>
                    <p className="text-base text-ink-muted mt-4 flex-1 leading-relaxed">{p.excerpt}</p>
                    <span className="mt-6 inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.18em] text-brand-700 border-b border-brand-700/30 pb-1 self-start group-hover:border-brand-700 transition">
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
    </>
  );
}
