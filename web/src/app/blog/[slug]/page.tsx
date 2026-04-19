import { notFound } from "next/navigation";
import { getBlogBySlug } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function BlogPost({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = await getBlogBySlug(slug);
  if (!post) notFound();
  return (
    <article>
      <section className="bg-hero-gradient">
        <div className="container-x py-10 sm:py-14 lg:py-16 text-center max-w-3xl mx-auto">
          <div className="text-sm text-ink-muted break-words">{new Date(post.published_at).toLocaleDateString()} • {post.author}</div>
          <h1 className="mt-2 text-3xl sm:text-4xl md:text-5xl font-bold text-ink break-words">{post.title}</h1>
        </div>
      </section>
      {post.cover_url && (
        <div className="container-x mt-[-1rem] sm:mt-[-2rem] mb-8 sm:mb-10">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={post.cover_url} alt={post.title} className="w-full aspect-[16/8] object-cover rounded-2xl sm:rounded-3xl shadow-card" />
        </div>
      )}
      <section className="container-x max-w-3xl pb-12 sm:pb-16 lg:pb-20 prose-content break-words">
        {(post.body_md ?? "").split("\n").map((line, i) => {
          if (line.startsWith("## ")) return <h2 key={i} className="font-display text-2xl font-bold text-ink mt-8 mb-3">{line.slice(3)}</h2>;
          if (line.startsWith("- "))  return <li key={i} className="ml-6 text-ink leading-relaxed list-disc">{line.slice(2)}</li>;
          if (!line.trim())            return <div key={i} className="h-3" />;
          return <p key={i} className="text-ink leading-relaxed mb-3">{line}</p>;
        })}
      </section>
    </article>
  );
}
