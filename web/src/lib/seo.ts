import type { Metadata } from "next";

// ─────────────────────────────────────────────────────────────────────────────
// Single source of truth for SEO/runtime host config.
//
// SITE_URL is read at RUNTIME (not baked in at build) so the same standalone
// image can serve both the .cloud preview host and the canonical .com host and
// emit the correct canonical / Open Graph URLs + robots policy per environment.
// Never `export const SITE_URL = ...` consumed inside a statically-rendered
// page — only read it from generateMetadata / dynamic (force-dynamic) pages,
// or via these helpers which are evaluated per request there.
// ─────────────────────────────────────────────────────────────────────────────

export const CANONICAL_HOST = "https://brightertomorrowtherapy.com";

/** Site origin, no trailing slash. Runtime-resolved. */
export const SITE_URL = (process.env.SITE_URL || CANONICAL_HOST).replace(/\/$/, "");

/** True only when serving the real production domain. */
export const IS_CANONICAL_HOST = SITE_URL === CANONICAL_HOST;

export const SITE_NAME = "Brighter Tomorrow Therapy Collective";

/** Brand suffix appended to page titles (consistent: em-dash). */
export const TITLE_SUFFIX = `— ${SITE_NAME}`;

/**
 * Default OG image shipped from /public. Override per-page via pageMetadata.
 * Points at a real existing asset so link-unfurls never 404; swap for a
 * purpose-built 1200×630 card if/when design provides one.
 */
export const DEFAULT_OG_IMAGE = "/images/home/hero-bg.jpg";

type PageMetadataInput = {
  /** Page title WITHOUT the brand suffix — the template/helper appends it. */
  title: string;
  description: string;
  /** Absolute site path, leading slash, no host (e.g. "/services/reiki"). */
  path: string;
  /** Optional OG image path (relative to /public or absolute URL). */
  ogImage?: string;
};

/**
 * Build a Next `Metadata` object with canonical URL + Open Graph + Twitter.
 *
 * `path` is stored as a path (not absolute) so Next resolves it against the
 * runtime `metadataBase` (set from SITE_URL in the root layout). This keeps the
 * canonical host correct across the .cloud/.com split without static baking.
 */
export function pageMetadata({
  title,
  description,
  path,
  ogImage,
}: PageMetadataInput): Metadata {
  const fullTitle = `${title} ${TITLE_SUFFIX}`;
  const image = ogImage ?? DEFAULT_OG_IMAGE;

  return {
    // `absolute` bypasses the root layout's title.template (a plain string
    // child title would have the template re-applied → doubled suffix). We
    // append the suffix here so OG/twitter titles match the document title.
    title: { absolute: fullTitle },
    description,
    alternates: { canonical: path },
    openGraph: {
      title: fullTitle,
      description,
      url: path,
      siteName: SITE_NAME,
      type: "website",
      locale: "en_US",
      images: image ? [{ url: image }] : undefined,
    },
    twitter: {
      card: image ? "summary_large_image" : "summary",
      title: fullTitle,
      description,
      images: image ? [image] : undefined,
    },
  };
}
