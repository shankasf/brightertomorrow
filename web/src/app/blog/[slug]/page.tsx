import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import Reveal from "@/components/Reveal";
import { getBlogBySlug } from "@/lib/queries";
import { renderMarkdown, stripMarkdown } from "@/lib/markdown";
import { SITE_URL, SITE_NAME, TITLE_SUFFIX } from "@/lib/seo";
import { FiArrowLeft } from "react-icons/fi";
import ShareButtons from "@/components/ShareButtons";

export const dynamic = "force-dynamic";

/** Build an absolute URL from a possibly-relative path against SITE_URL. */
function absoluteUrl(pathOrUrl: string | null | undefined): string | undefined {
  if (!pathOrUrl) return undefined;
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  return `${SITE_URL}${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}`;
}

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> },
): Promise<Metadata> {
  const { slug } = await params;
  const post = await getBlogBySlug(slug);
  // Throw here, not just in the page body: metadata resolves before streaming
  // starts, so this is what makes the response a real HTTP 404 (not a soft 200).
  if (!post) notFound();

  const description =
    (post.excerpt?.trim() || stripMarkdown(post.body_md, 155)) ||
    `An article from ${SITE_NAME}.`;
  const canonical = `/blog/${post.slug}`;
  // cover_url is usually relative (/images/...) → let metadataBase resolve it;
  // pass through if already absolute (external host).
  const ogImage = post.cover_url || undefined;
  const fullTitle = `${post.title} ${TITLE_SUFFIX}`;

  return {
    // `absolute` so the root layout's title.template isn't re-applied (no
    // doubled brand suffix), matching the pattern in lib/seo.pageMetadata.
    title: { absolute: fullTitle },
    description,
    alternates: { canonical },
    openGraph: {
      type: "article",
      title: fullTitle,
      description,
      url: canonical,
      siteName: SITE_NAME,
      locale: "en_US",
      publishedTime: post.published_at,
      authors: post.author ? [post.author] : undefined,
      images: ogImage ? [{ url: ogImage, alt: post.title }] : undefined,
    },
    twitter: {
      card: ogImage ? "summary_large_image" : "summary",
      title: fullTitle,
      description,
      images: ogImage ? [ogImage] : undefined,
    },
  };
}

export default async function BlogPost({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = await getBlogBySlug(slug);
  if (!post) notFound();

  const date = new Date(post.published_at).toLocaleDateString("en-US", {
    month: "long", day: "numeric", year: "numeric",
  });

  const html = renderMarkdown(post.body_md);
  const canonicalUrl = `${SITE_URL}/blog/${post.slug}`;
  const ogImage = absoluteUrl(post.cover_url);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    datePublished: post.published_at,
    dateModified: post.published_at,
    description: post.excerpt?.trim() || stripMarkdown(post.body_md, 155),
    ...(ogImage ? { image: [ogImage] } : {}),
    author: { "@type": "Person", name: post.author || SITE_NAME },
    publisher: {
      "@type": "Organization",
      name: SITE_NAME,
      url: SITE_URL,
    },
    mainEntityOfPage: { "@type": "WebPage", "@id": canonicalUrl },
    url: canonicalUrl,
  };

  return (
    <article>
      {/* JSON-LD structured data for the BlogPosting */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      {/* Page header */}
      <section className="bg-cream-alt relative overflow-hidden">
        <div aria-hidden className="absolute inset-0 bg-grid opacity-[0.06]" />
        <div className="container-narrow relative py-16 sm:py-20 lg:py-24 text-center">
          <Reveal>
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
            <div className="mt-8 flex justify-center">
              <ShareButtons title={post.title} />
            </div>
          </Reveal>
        </div>
      </section>

      {/* Cover image */}
      {post.cover_url && (
        <Reveal className="container-x -mt-8 sm:-mt-10 mb-12 sm:mb-16 block">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={post.cover_url}
            alt={post.title}
            className="w-full aspect-[16/8] object-cover rounded-3xl sm:rounded-4xl shadow-card border border-surface-line"
          />
        </Reveal>
      )}

      {/* Body */}
      <section className="container-narrow pb-16 sm:pb-20 lg:pb-24">
        <Reveal className="block">
          <div
            className="blog-prose"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </Reveal>

        {/* Footer */}
        <Reveal className="mt-16 pt-8 border-t border-surface-line flex items-center justify-between gap-4 flex-wrap">
          <Link
            href="/blog"
            className="inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.18em] text-brand-700 hover:text-brand transition"
          >
            <FiArrowLeft /> Back to blog
          </Link>
          <ShareButtons title={post.title} />
        </Reveal>
      </section>
    </article>
  );
}
