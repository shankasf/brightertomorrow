import Link from "next/link";
import { getBlogPosts } from "@/lib/queries";
import BlogHero from "./BlogHero";
import BlogCard from "./BlogCard";

export const metadata = {
  title: "Blog — Brighter Tomorrow Therapy",
  description:
    "Notes from our clinicians on therapy, mental health, and the everyday work of becoming.",
};

const GOLD = "#E1B878";
const INK = "#192735";

const goldBtn =
  "inline-block font-display font-bold tracking-[0.15em] text-[13px] uppercase px-8 py-4 transition hover:opacity-90";

export default async function BlogIndex() {
  const posts = await getBlogPosts();
  return (
    <article className="bg-white">
      {/* HERO */}
      <BlogHero />

      {/* BLOG GRID */}
      <section className="bg-white py-16 lg:py-20">
        <div className="container-x">
          <h2
            className="text-center font-display font-bold text-[28px] sm:text-[34px] lg:text-[37.5px] mb-12"
            style={{ color: INK }}
          >
            Blog &amp; Articles
          </h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-8 lg:gap-10">
            {posts.map((p, i) => (
              <BlogCard key={p.id} post={p} delay={i * 0.05} />
            ))}
          </div>
        </div>
      </section>

      {/* CTA BANNER */}
      <section className="relative overflow-hidden">
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{
            backgroundImage:
              "linear-gradient(rgba(110,122,138,0.85), rgba(110,122,138,0.85)), url('/images/blog-list/cta-bg.jpg')",
          }}
          aria-hidden
        />
        <div className="relative container-x py-20 lg:py-24 text-center">
          <p
            className="font-script italic text-[20px] sm:text-[24px]"
            style={{ color: GOLD }}
          >
            Ready to begin your healing journey?
          </p>
          <h3 className="mt-3 font-display font-bold text-[32px] sm:text-[40px] lg:text-[45px] text-white leading-[1.15]">
            Take the first step on the path toward a{" "}
            <span style={{ color: GOLD }}>brighter tomorrow</span>!
          </h3>
          <div className="mt-8">
            <Link
              href="/contact"
              className={goldBtn}
              style={{ backgroundColor: GOLD, color: INK, borderRadius: "30px 0 30px 30px" }}
            >
              Consultation Now
            </Link>
          </div>
        </div>
      </section>
    </article>
  );
}
