import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/seo";
import {
  getBlogPosts,
  getBlogCategories,
  getServices,
  getSpecialties,
} from "@/lib/queries";
import { getAllTeamBioSlugs } from "@/lib/teamBio";

// Per-request: SITE_URL is runtime env and the post/category/team sets come from
// Postgres + on-disk bio JSON, none of which exist at build time. force-dynamic
// keeps the sitemap in lockstep with the live content and the canonical host.
export const dynamic = "force-dynamic";

// Top-level static marketing pages (App Router dirs with a page.tsx, minus
// /admin, /api and the blog-internal listing which we enumerate from the DB).
// Discovered from src/app/*; keep in sync when a static page is added/removed.
const STATIC_PATHS = [
  "", // homepage
  "about",
  "affordable-therapy",
  "approach",
  "careers",
  "contact",
  "faqs",
  "fees-insurance",
  "privacy-policy",
  "rates",
  "story",
  "team",
  "therapists-match-quiz",
  "services", // services index
  "specialties", // specialties index
  "blog", // blog index
] as const;

// /services/<slug> and /specialties/<slug> detail pages are served by the
// [slug] catch-all, which resolves each slug via getServiceBySlug /
// getSpecialtyBySlug against the published DB rows (each bespoke <slug>/Content
// .tsx is just the body the catch-all imports). Sourcing the slug list from the
// same published rows keeps the sitemap in lockstep with what actually renders
// 200 — no hand-maintained list to drift. (/services/journal also has its own
// page.tsx, but the URL is identical, so it's still one entry.)
function abs(path: string): string {
  return path ? `${SITE_URL}/${path}` : SITE_URL;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  const [posts, categories, teamSlugs, services, specialties] =
    await Promise.all([
      getBlogPosts().catch(() => []),
      getBlogCategories().catch(() => []),
      getAllTeamBioSlugs().catch(() => []),
      getServices().catch(() => []),
      getSpecialties().catch(() => []),
    ]);

  const entries: MetadataRoute.Sitemap = [];

  // ── Static pages ──
  for (const p of STATIC_PATHS) {
    entries.push({
      url: abs(p),
      lastModified: now,
      changeFrequency: p === "" || p === "blog" ? "weekly" : "monthly",
      priority: p === "" ? 1 : 0.7,
    });
  }

  // ── Service detail pages (published DB rows → /services/<slug>) ──
  for (const svc of services) {
    entries.push({
      url: abs(`services/${svc.slug}`),
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.8,
    });
  }

  // ── Specialty detail pages (published DB rows → /specialties/<slug>) ──
  for (const sp of specialties) {
    entries.push({
      url: abs(`specialties/${sp.slug}`),
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.8,
    });
  }

  // ── Team member bio pages (one JSON file per published therapist) ──
  for (const slug of teamSlugs) {
    entries.push({
      url: abs(`team/${slug}`),
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.6,
    });
  }

  // ── Category archive pages (only categories that have published posts) ──
  for (const c of categories) {
    entries.push({
      url: abs(`category/${c.slug}`),
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.5,
    });
  }

  // ── Blog posts (lastmod from published_at) ──
  for (const post of posts) {
    const lastmod = post.published_at ? new Date(post.published_at) : now;
    entries.push({
      url: abs(`blog/${post.slug}`),
      lastModified: Number.isNaN(lastmod.getTime()) ? now : lastmod,
      changeFrequency: "monthly",
      priority: 0.6,
    });
  }

  return entries;
}
