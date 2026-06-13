import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { pageMetadata } from "@/lib/seo";
import { JsonLd, breadcrumbGraph } from "@/components/StructuredData";
import { FiArrowLeft } from "react-icons/fi";
import {
  getBlogCategoryBySlug,
  getBlogPostsByCategoryPage,
  countBlogPostsByCategory,
} from "@/lib/queries";
import BlogCard from "../../blog/BlogCard";
import Pagination from "@/components/Pagination";

// Mirrors the WordPress (.com) /category/<slug> archive pages.
export const dynamic = "force-dynamic";

const INK = "#192735";
const PER_PAGE = 12;

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> },
): Promise<Metadata> {
  const { slug } = await params;
  const cat = await getBlogCategoryBySlug(slug);
  // Throw here, not just in the page body: metadata resolves before streaming
  // starts, so this is what makes the response a real HTTP 404 (not a soft 200).
  if (!cat) notFound();
  return pageMetadata({
    title: cat.name,
    description: `Articles filed under ${cat.name} from the Brighter Tomorrow Therapy Collective blog — mental health insights for Las Vegas, NV.`,
    path: `/category/${slug}`,
  });
}

export default async function CategoryArchive(
  {
    params,
    searchParams,
  }: {
    params: Promise<{ slug: string }>;
    searchParams: Promise<{ page?: string }>;
  },
) {
  const { slug } = await params;
  const { page: pageParam } = await searchParams;
  const cat = await getBlogCategoryBySlug(slug);
  if (!cat) notFound();

  const total = await countBlogPostsByCategory(cat.id);
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));
  const page = Math.min(totalPages, Math.max(1, parseInt(pageParam ?? "1", 10) || 1));
  const posts = await getBlogPostsByCategoryPage(cat.id, PER_PAGE, (page - 1) * PER_PAGE);

  return (
    <article className="bg-white">
      <JsonLd
        data={breadcrumbGraph([
          { name: "Home", path: "/" },
          { name: "Blog", path: "/blog" },
          { name: cat.name, path: `/category/${slug}` },
        ])}
      />
      <section className="bg-cream-alt relative overflow-hidden">
        <div aria-hidden className="absolute inset-0 bg-grid opacity-[0.06]" />
        <div className="container-narrow relative py-20 sm:py-28 text-center">
          <Link
            href="/blog"
            className="inline-flex items-center gap-2 text-sm text-brand-700 hover:text-brand transition mb-8"
          >
            <FiArrowLeft /> All articles
          </Link>
          <span className="eyebrow center">Category</span>
          <h1 className="mt-6 display text-4xl sm:text-5xl md:text-6xl text-ink">
            {cat.name}
          </h1>
          <p className="mt-6 text-ink-muted text-lg max-w-2xl mx-auto">
            {total} article{total === 1 ? "" : "s"} in this category
            {totalPages > 1 ? ` · page ${page} of ${totalPages}` : ""}.
          </p>
        </div>
      </section>

      <section className="bg-white py-16 lg:py-20">
        <div className="container-x">
          {posts.length === 0 ? (
            <p className="text-center text-ink-muted">No articles in this category yet.</p>
          ) : (
            <>
              <h2
                className="text-center font-display font-bold text-[28px] sm:text-[34px] mb-12"
                style={{ color: INK }}
              >
                Browse {cat.name}
              </h2>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-8 lg:gap-10">
                {posts.map((p, i) => (
                  <BlogCard key={p.id} post={p} delay={i * 0.05} />
                ))}
              </div>
              <Pagination
                currentPage={page}
                totalPages={totalPages}
                basePath={`/category/${cat.slug}`}
              />
            </>
          )}
        </div>
      </section>
    </article>
  );
}
