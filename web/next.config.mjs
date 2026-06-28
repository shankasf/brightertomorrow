import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const blogRedirectSlugs = JSON.parse(
  readFileSync(fileURLToPath(new URL("./src/data/blog-redirect-slugs.json", import.meta.url)), "utf8"),
);

// On WordPress (.com) every blog post lived at the root (/<post-slug>). On
// .cloud posts are canonical under /blog/<slug>, so 301 each old root URL into
// /blog to preserve organic/SEO traffic. Snapshot of the migrated post set.
const blogRootRedirects = blogRedirectSlugs.map((slug) => ({
  source: `/${slug}`,
  destination: `/blog/${slug}`,
  permanent: true,
}));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
  devIndicators: false,
  // Strip `x-powered-by: Next.js` — info disclosure that gives attackers a
  // free hint about stack version. No functional impact.
  poweredByHeader: false,
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "brightertomorrowtherapy.com" },
      { protocol: "https", hostname: "**.brightertomorrowtherapy.com" },
    ],
  },
  // 301 redirects. Canonical detail URLs are nested under /services/* and
  // /specialties/*. The flat .com URLs (e.g. /teletherapy) and older .cloud
  // slug variants redirect into the nested canonical so organic/SEO traffic is
  // preserved. (Routes that already ARE canonical are NOT listed — no loops.)
  async redirects() {
    return [
      // ── Old WordPress sitemap paths → Next sitemap. Google has the WP
      // sitemap index (/sitemaps.xml) and its per-type sub-sitemaps cached
      // and keeps polling them after cutover. ──
      { source: "/sitemaps.xml", destination: "/sitemap.xml", permanent: true },
      { source: "/sitemap_index.xml", destination: "/sitemap.xml", permanent: true },
      { source: "/:type(post|page|category|post_tag)-sitemap:n(\\d+).xml", destination: "/sitemap.xml", permanent: true },
      // ── Flat .com service URLs → nested canonical ──
      { source: "/individual-therapy", destination: "/services/individual-therapy", permanent: true },
      { source: "/couples-counseling", destination: "/services/couples-counseling", permanent: true },
      { source: "/group-therapy", destination: "/services/group-therapy", permanent: true },
      { source: "/adhd-testing", destination: "/services/adhd-testing", permanent: true },
      { source: "/journal", destination: "/services/journal", permanent: true },
      { source: "/reiki", destination: "/services/reiki", permanent: true },
      { source: "/teletherapy", destination: "/services/teletherapy", permanent: true },
      { source: "/emotional-support-animal-esa-letters-in-las-vegas", destination: "/services/emotional-support-animal-esa-letters-in-las-vegas", permanent: true },
      // ── Flat .com specialty URLs → nested canonical ──
      { source: "/anxiety-therapy", destination: "/specialties/anxiety-therapy", permanent: true },
      { source: "/child-therapy", destination: "/specialties/child-therapy", permanent: true },
      { source: "/depression-therapy", destination: "/specialties/depression-therapy", permanent: true },
      { source: "/geriatric-counseling", destination: "/specialties/geriatric-counseling", permanent: true },
      { source: "/grief-counseling", destination: "/specialties/grief-counseling", permanent: true },
      { source: "/lgbtqia-affirming-therapy", destination: "/specialties/lgbtqia-affirming-therapy", permanent: true },
      { source: "/life-transitions-counseling", destination: "/specialties/life-transitions-counseling", permanent: true },
      { source: "/parts-and-memory-therapy", destination: "/specialties/parts-and-memory-therapy", permanent: true },
      { source: "/relationship-counseling", destination: "/specialties/relationship-counseling", permanent: true },
      { source: "/teen-counseling", destination: "/specialties/teen-counseling", permanent: true },
      { source: "/trauma-and-ptsd", destination: "/specialties/trauma-and-ptsd", permanent: true },
      // ── Old .cloud renamed / short slug variants → nested canonical ──
      { source: "/services/esa-letters", destination: "/services/emotional-support-animal-esa-letters-in-las-vegas", permanent: true },
      { source: "/services/anxiety-depression-therapy", destination: "/specialties/anxiety-therapy", permanent: true },
      { source: "/services/child-teen-therapy", destination: "/specialties/child-therapy", permanent: true },
      { source: "/services/trauma-ptsd-therapy", destination: "/specialties/trauma-and-ptsd", permanent: true },
      { source: "/specialties/lgbtqia-therapy", destination: "/specialties/lgbtqia-affirming-therapy", permanent: true },
      { source: "/specialties/life-transitions", destination: "/specialties/life-transitions-counseling", permanent: true },
      { source: "/specialties/parts-memory-therapy", destination: "/specialties/parts-and-memory-therapy", permanent: true },
      { source: "/specialties/teen-therapy", destination: "/specialties/teen-counseling", permanent: true },
      { source: "/specialties/trauma-ptsd", destination: "/specialties/trauma-and-ptsd", permanent: true },
      { source: "/specialties/anxiety", destination: "/specialties/anxiety-therapy", permanent: true },
      { source: "/specialties/child", destination: "/specialties/child-therapy", permanent: true },
      { source: "/specialties/couples", destination: "/services/couples-counseling", permanent: true },
      { source: "/specialties/depression", destination: "/specialties/depression-therapy", permanent: true },
      { source: "/specialties/geriatric", destination: "/specialties/geriatric-counseling", permanent: true },
      { source: "/specialties/grief", destination: "/specialties/grief-counseling", permanent: true },
      { source: "/specialties/lgbtqia", destination: "/specialties/lgbtqia-affirming-therapy", permanent: true },
      { source: "/specialties/teen", destination: "/specialties/teen-counseling", permanent: true },
      { source: "/specialties/relationship", destination: "/specialties/relationship-counseling", permanent: true },
      // ── Renamed static pages ──
      { source: "/our-approach", destination: "/approach", permanent: true },
      { source: "/our-story", destination: "/story", permanent: true },
      { source: "/privacy", destination: "/privacy-policy", permanent: true },
      // ── Old WordPress (.com) therapist root slugs → /team/<slug> ──
      // On WordPress each therapist lived at /<slug>; canonical is now
      // /team/<slug>. Targets verified against src/content/team/*.json (the
      // source getTeamBio() reads). Slugs with NO bio file 404 on /team/<slug>,
      // so they redirect to the /team roster instead:
      //   estefania-gil  → no bio file → /team
      //   yvette-howard  → not in roster → /team
      //   jordan-fuller-student → /team/jordan-fuller (his only bio)
      { source: "/alayna-hammond", destination: "/team/alayna-hammond", permanent: true },
      // Alexzandria Summers resigned 2026-06-26 — old bio URL now redirects to the roster.
      { source: "/alexzandria-summers", destination: "/team", permanent: true },
      { source: "/team/alexzandria-summers", destination: "/team", permanent: true },
      { source: "/elisia-danley", destination: "/team/elisia-danley", permanent: true },
      { source: "/estefania-gil", destination: "/team", permanent: true },
      { source: "/janelle-thompson", destination: "/team/janelle-thompson", permanent: true },
      { source: "/joanne-tran", destination: "/team/joanne-tran", permanent: true },
      { source: "/jordan-fuller", destination: "/team/jordan-fuller", permanent: true },
      { source: "/jordan-fuller-student", destination: "/team/jordan-fuller", permanent: true },
      { source: "/keunshea-fleming", destination: "/team/keunshea-fleming", permanent: true },
      { source: "/lorenthia-clayton", destination: "/team/lorenthia-clayton", permanent: true },
      { source: "/miranda-pulido", destination: "/team/miranda-pulido", permanent: true },
      { source: "/monica-gonzalez", destination: "/team/monica-gonzalez", permanent: true },
      { source: "/nicole-pangelinan", destination: "/team/nicole-pangelinan", permanent: true },
      { source: "/pascha-broadie", destination: "/team/pascha-broadie", permanent: true },
      { source: "/samara-cobb", destination: "/team/samara-cobb", permanent: true },
      { source: "/sherrita-williams", destination: "/team/sherrita-williams", permanent: true },
      { source: "/tony-martinez", destination: "/team/tony-martinez", permanent: true },
      { source: "/yvette-howard", destination: "/team", permanent: true },
      // ── Old WordPress team-listing landing pages → /team roster ──
      { source: "/e-russell-team", destination: "/team", permanent: true },
      { source: "/n-durango-team", destination: "/team", permanent: true },
      { source: "/telehealth-team", destination: "/team", permanent: true },
      { source: "/studenttherapists-team", destination: "/team", permanent: true },
      // ── WordPress tag archives (not migrated) → blog index ──
      { source: "/tag/:slug*", destination: "/blog", permanent: true },
      // ── Old root blog-post URLs (WordPress .com) → /blog/<slug> ──
      ...blogRootRedirects,
    ];
  },

  async rewrites() {
    return [
      {
        source: "/api/ai/:path*",
        destination: `${process.env.AI_SERVICE_URL || "http://127.0.0.1:8001"}/:path*`,
      },
      // admin.brightertomorrowtherapy.cloud serves the same Next.js app as the
      // public site, but visitors hitting the root or any non-/admin URL there
      // should land on the admin app, not the marketing site.
      // Match the admin host on BOTH the preview (.cloud) and the production
      // (.com) apex via a host regex (Next `has.value` is a regex anchored to
      // the full value).
      {
        source: "/",
        has: [{ type: "host", value: "admin\\.brightertomorrowtherapy\\.(cloud|com)" }],
        destination: "/admin",
      },
      {
        source: "/:path((?!admin|_next|favicon|api).*)",
        has: [{ type: "host", value: "admin\\.brightertomorrowtherapy\\.(cloud|com)" }],
        destination: "/admin/:path",
      },
    ];
  },
};
export default nextConfig;
