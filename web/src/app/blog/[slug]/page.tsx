import Link from "next/link";
import { notFound } from "next/navigation";
import { getBlogBySlug } from "@/lib/queries";
import { FiArrowLeft, FiShare2 } from "react-icons/fi";

export const dynamic = "force-dynamic";

export default async function BlogPost({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = await getBlogBySlug(slug);
  if (!post) notFound();

  const date = new Date(post.published_at).toLocaleDateString("en-US", {
    month: "long", day: "numeric", year: "numeric",
  });

  return (
    <article>
      {/* Page header */}
      <section className="bg-cream-alt relative overflow-hidden">
        <div aria-hidden className="absolute inset-0 bg-grid opacity-[0.06]" />
        <div className="container-narrow relative py-16 sm:py-20 lg:py-24 text-center">
          <Link
            href="/blog"
            className="inline-flex items-center gap-2 text-sm text-brand-700 hover:text-brand transition mb-8"
          >
            <FiArrowLeft /> All articles
          </Link>
          <div className="eyebrow-bare text-brand-700 text-[11px]">
            {date}
          </div>
          <h1 className="mt-5 display text-4xl sm:text-5xl lg:text-6xl text-ink break-words leading-[1.05]">
            {post.title}
          </h1>
          <svg aria-hidden viewBox="0 0 200 8" className="mx-auto mt-7 w-32 h-2 text-brand">
            <path d="M2 5 Q 50 0 100 4 T 198 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <div className="mt-7 inline-flex items-center gap-3 text-sm text-ink-muted">
            <span className="w-9 h-9 rounded-full bg-sage-100 text-sage-700 grid place-items-center font-display font-semibold text-sm">
              {(post.author ?? "BT").split(/\s+/).map((s) => s[0]).join("").slice(0, 2).toUpperCase()}
            </span>
            <span className="font-display text-base text-ink">{post.author}</span>
          </div>
        </div>
      </section>

      {/* Cover image */}
      {post.cover_url && (
        <div className="container-x -mt-8 sm:-mt-10 mb-12 sm:mb-16">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={post.cover_url}
            alt={post.title}
            className="w-full aspect-[16/8] object-cover rounded-3xl sm:rounded-4xl shadow-card border border-surface-line"
          />
        </div>
      )}

      {/* Body */}
      <section className="container-narrow pb-16 sm:pb-20 lg:pb-24">
        <div className="text-lg leading-[1.85] text-ink-muted break-words">
          {(post.body_md ?? "").split("\n").map((line, i) => {
            if (line.startsWith("## ")) {
              return (
                <h2
                  key={i}
                  className="font-display text-3xl text-ink mt-12 mb-4 leading-tight"
                >
                  {line.slice(3)}
                </h2>
              );
            }
            if (line.startsWith("# ")) {
              return (
                <h2
                  key={i}
                  className="font-display text-3xl text-ink mt-12 mb-4 leading-tight"
                >
                  {line.slice(2)}
                </h2>
              );
            }
            if (line.startsWith("- ")) {
              return (
                <li key={i} className="ml-6 list-disc my-2">
                  {line.slice(2)}
                </li>
              );
            }
            if (!line.trim()) return <div key={i} className="h-3" />;
            return <p key={i} className="my-5">{line}</p>;
          })}
        </div>

        {/* Footer */}
        <div className="mt-16 pt-8 border-t border-surface-line flex items-center justify-between gap-4 flex-wrap">
          <Link
            href="/blog"
            className="inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.18em] text-brand-700 hover:text-brand transition"
          >
            <FiArrowLeft /> Back to blog
          </Link>
          <a
            href={`mailto:?subject=${encodeURIComponent(post.title)}&body=${encodeURIComponent(post.title)}`}
            className="inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.18em] text-ink-muted hover:text-brand-700 transition"
          >
            <FiShare2 /> Share article
          </a>
        </div>
      </section>
    </article>
  );
}
