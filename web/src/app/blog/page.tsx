import Link from "next/link";
import Reveal from "@/components/Reveal";
import { getBlogPosts } from "@/lib/queries";

export const metadata = { title: "Blog — Brighter Tomorrow Therapy" };

export default async function BlogIndex() {
  const posts = await getBlogPosts();
  return (
    <>
      <section className="bg-hero-gradient">
        <div className="container-x py-10 sm:py-14 lg:py-16 text-center">
          <span className="text-xs uppercase tracking-[0.2em] text-brand font-semibold">Journal</span>
          <h1 className="mt-2 text-3xl sm:text-4xl md:text-5xl font-bold text-ink">From the blog.</h1>
        </div>
      </section>
      <section className="section !py-10 sm:!py-14 lg:!py-20">
        <div className="container-x grid sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5 lg:gap-6">
          {posts.map((p, i) => (
            <Reveal key={p.id} delay={i * 0.04}>
              <Link href={`/blog/${p.slug}`} className="group block bg-white rounded-2xl overflow-hidden border border-surface-line hover:shadow-card transition">
                {p.cover_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.cover_url} alt={p.title} className="w-full aspect-[16/10] object-cover group-hover:scale-105 transition-transform duration-500" />
                )}
                <div className="p-5">
                  <div className="text-xs text-ink-muted">{new Date(p.published_at).toLocaleDateString()}</div>
                  <h3 className="font-display text-lg font-semibold mt-1 text-ink group-hover:text-brand transition break-words">{p.title}</h3>
                  <p className="text-sm text-ink-muted mt-2">{p.excerpt}</p>
                </div>
              </Link>
            </Reveal>
          ))}
        </div>
      </section>
    </>
  );
}
