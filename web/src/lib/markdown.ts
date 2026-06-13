import "server-only";
import { marked } from "marked";
import DOMPurify from "isomorphic-dompurify";

/**
 * Strip our own scheme+host from in-body links so migrated WordPress posts that
 * still point at https://(www.)brightertomorrowtherapy.(com|cloud)/... become
 * site-relative paths. The next.config redirects then route the old flat slugs
 * to their nested canonical (e.g. /individual-therapy → /services/...).
 *
 * This is a RENDER-TIME rewrite only — the DB body_md is never mutated.
 * Bare /wp-content image links are left untouched on purpose (they're assets).
 */
function rewriteInternalLinks(md: string): string {
  // Markdown link target: ](<url>) — only rewrite our own hosts.
  return md.replace(
    /\]\(\s*https?:\/\/(?:www\.)?brightertomorrowtherapy\.(?:com|cloud)(\/[^)\s]*)?\s*\)/gi,
    (_match, path: string | undefined) => `](${path || "/"})`,
  );
}

/**
 * Render admin-authored markdown (from bt.blog_posts.body_md) to sanitized HTML.
 *
 * Content is first-party, but marked does NOT sanitize, so we run output through
 * DOMPurify with a tight allowlist to defang any stray <script>/event handlers.
 * Runs server-side only (see "server-only"); DOMPurify never reaches the client
 * bundle. Returns a string for use with dangerouslySetInnerHTML.
 */
export function renderMarkdown(md: string | null | undefined): string {
  if (!md) return "";

  const rewritten = rewriteInternalLinks(md);

  const rawHtml = marked.parse(rewritten, {
    async: false,
    gfm: true,
    breaks: false,
  }) as string;

  return DOMPurify.sanitize(rawHtml, {
    ALLOWED_TAGS: [
      "h1", "h2", "h3", "h4", "h5", "h6",
      "p", "a", "ul", "ol", "li",
      "blockquote", "strong", "em", "b", "i",
      "br", "hr", "code", "pre", "img",
    ],
    ALLOWED_ATTR: ["href", "title", "target", "rel", "src", "alt"],
    // Block javascript:/data: URIs etc.
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|tel:|\/|#)/i,
  });
}

/**
 * Strip markdown syntax down to plain text for meta descriptions / excerpts.
 * Best-effort: removes headings, emphasis, link syntax (keeps link text),
 * list markers, blockquotes, and collapses whitespace.
 */
export function stripMarkdown(md: string | null | undefined, max = 155): string {
  if (!md) return "";
  const text = md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "") // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // links → text
    .replace(/^#{1,6}\s+/gm, "") // headings
    .replace(/[*_~`>]/g, "") // emphasis / blockquote / code markers
    .replace(/^[\s-]*[-*+]\s+/gm, "") // list bullets
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= max) return text;
  // Cut on a word boundary near the limit.
  const slice = text.slice(0, max);
  const lastSpace = slice.lastIndexOf(" ");
  return `${(lastSpace > 40 ? slice.slice(0, lastSpace) : slice).trim()}…`;
}
