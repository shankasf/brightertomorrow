import { NextResponse } from "next/server";
import { SITE_URL, IS_CANONICAL_HOST, SITE_NAME } from "@/lib/seo";
import {
  getBlogPosts,
  getBlogCategories,
  getServices,
  getSpecialties,
} from "@/lib/queries";

// /llms.txt — the LLM-discovery file (https://llmstxt.org). A concise, plain-
// markdown map of the site so AI assistants (ChatGPT, Claude, Perplexity, etc.)
// can find and cite the right pages instead of guessing from scraped HTML.
//
// Generated per-request from the SAME live sources as sitemap.ts (Postgres
// services/specialties/blog + runtime SITE_URL), so it stays in lockstep with
// published content automatically — there is no hand-maintained list to drift.
// force-dynamic for the same reason the sitemap is dynamic: SITE_URL and the
// content rows don't exist at build time.
export const dynamic = "force-dynamic";

// Curated blurbs for the static marketing pages (mirrors sitemap.ts
// STATIC_PATHS — keep in sync when a static page is added/removed).
const STATIC_PAGES: ReadonlyArray<{ path: string; title: string; desc: string }> = [
  { path: "", title: "Home", desc: "Las Vegas & North Las Vegas therapy for children, teens, and adults — in-person and online, evenings and weekends." },
  { path: "about", title: "About", desc: "Who we are and how the collective approaches compassionate, accessible mental health care." },
  { path: "story", title: "Our Story", desc: "The story behind Brighter Tomorrow Therapy Collective." },
  { path: "approach", title: "Our Approach", desc: "How we work with clients and the modalities our therapists use." },
  { path: "team", title: "Meet the Team", desc: "Our therapists and clinicians, their specialties, and availability." },
  { path: "services", title: "Services", desc: "Therapy services we offer across individual, couples, family, and group care." },
  { path: "specialties", title: "Specialties", desc: "Conditions and focus areas our clinicians specialize in." },
  { path: "fees-insurance", title: "Fees & Insurance", desc: "Session fees, accepted insurances, and self-pay / out-of-network options. Note: we do not accept Medicaid plans." },
  { path: "rates", title: "Rates", desc: "Self-pay session rates, including reduced rates for graduate student interns; HSA/FSA accepted." },
  { path: "affordable-therapy", title: "Affordable Therapy", desc: "Lower-cost therapy options, including supervised graduate student interns." },
  { path: "therapists-match-quiz", title: "Therapist Match Quiz", desc: "A short quiz to match you with a therapist who fits your needs." },
  { path: "faqs", title: "FAQs", desc: "Common questions about booking, insurance, the client portal, and sessions." },
  { path: "contact", title: "Contact", desc: "How to reach us to book or ask a question — phone 725-238-6990." },
  { path: "careers", title: "Careers", desc: "Open roles and what it's like to work at the collective." },
  { path: "blog", title: "Blog", desc: "Articles on mental health, therapy, and wellbeing." },
  { path: "privacy-policy", title: "Privacy Policy", desc: "How we handle your information (HIPAA-compliant)." },
];

/** Collapse whitespace and trim to a single clean line for a list entry. */
function oneLine(s: string | null | undefined, max = 160): string {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

function abs(path: string): string {
  return path ? `${SITE_URL}/${path}` : SITE_URL;
}

function link(title: string, url: string, desc?: string | null): string {
  const d = oneLine(desc);
  return d ? `- [${title}](${url}): ${d}` : `- [${title}](${url})`;
}

export async function GET() {
  // Never expose a site map of preview/admin hosts to crawlers.
  if (!IS_CANONICAL_HOST) {
    return new NextResponse("User-agent: *\nDisallow: /\n", {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const [services, specialties, categories, posts] = await Promise.all([
    getServices().catch(() => []),
    getSpecialties().catch(() => []),
    getBlogCategories().catch(() => []),
    getBlogPosts().catch(() => []),
  ]);

  const lines: string[] = [];

  lines.push(`# ${SITE_NAME}`);
  lines.push("");
  lines.push(
    "> Brighter Tomorrow Therapy Collective is a Las Vegas / North Las Vegas " +
      "mental-health practice offering therapy for children, teens, and adults — " +
      "in person and online, with evening and weekend availability."
  );
  lines.push("");
  lines.push(
    "We accept most major insurances and offer self-pay / out-of-network and " +
      "reduced student-intern rates. We do not accept Medicaid plans. To book, " +
      "call 725-238-6990 or use the website chat assistant."
  );
  lines.push("");

  // ── Core pages ──
  lines.push("## Core pages");
  for (const p of STATIC_PAGES) lines.push(link(p.title, abs(p.path), p.desc));
  lines.push("");

  // ── Services (published DB rows → /services/<slug>) ──
  if (services.length) {
    lines.push("## Services");
    for (const s of services) {
      lines.push(link(s.title, abs(`services/${s.slug}`), s.short_desc));
    }
    lines.push("");
  }

  // ── Specialties (published DB rows → /specialties/<slug>) ──
  if (specialties.length) {
    lines.push("## Specialties");
    for (const sp of specialties) {
      lines.push(link(sp.title, abs(`specialties/${sp.slug}`), sp.short_desc));
    }
    lines.push("");
  }

  // ── Blog ──
  if (posts.length) {
    lines.push("## Blog");
    // Keep llms.txt navigational, not exhaustive: link the index + categories,
    // then the most recent posts (getBlogPosts returns newest-first).
    lines.push(link("All articles", abs("blog")));
    for (const c of categories) {
      lines.push(link(`Category: ${c.name}`, abs(`category/${c.slug}`)));
    }
    for (const post of posts.slice(0, 30)) {
      lines.push(link(post.title, abs(`blog/${post.slug}`), post.excerpt));
    }
    lines.push("");
  }

  const body = lines.join("\n");
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      // Short edge cache; content is dynamic but doesn't change minute-to-minute.
      "Cache-Control": "public, max-age=300, s-maxage=600",
    },
  });
}
