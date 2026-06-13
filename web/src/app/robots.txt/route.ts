import { NextResponse } from "next/server";
import { SITE_URL, IS_CANONICAL_HOST } from "@/lib/seo";

// /robots.txt — served by a route handler (not the Next metadata API) so we can
// emit a plain-text comment pointing at /llms.txt and explicit per-bot rules,
// neither of which MetadataRoute.Robots can express.
//
// Per-request: the same image serves the canonical apex (.com) AND preview
// hosts (.cloud, admin.*). Only the canonical host gets an "allow" policy;
// everywhere else is blanket-disallowed so previews never get indexed.
export const dynamic = "force-dynamic";

// AI-assistant crawlers we explicitly welcome. They already fall under the
// `User-agent: *` allow, but naming them removes ambiguity and is the
// convention these operators document for opting in.
const AI_BOTS = [
  "GPTBot", // OpenAI / ChatGPT
  "OAI-SearchBot", // OpenAI search
  "ChatGPT-User", // ChatGPT browsing on user request
  "ClaudeBot", // Anthropic crawler
  "Claude-Web", // Anthropic on-demand fetch
  "anthropic-ai", // Anthropic (legacy token)
  "PerplexityBot", // Perplexity
  "Perplexity-User", // Perplexity on-demand fetch
  "Google-Extended", // Google Gemini / Vertex training + grounding
  "Applebot-Extended", // Apple Intelligence
  "Bingbot", // Bing (feeds Copilot / ChatGPT search)
];

export async function GET() {
  const lines: string[] = [];

  if (!IS_CANONICAL_HOST) {
    // Preview / admin subdomain — keep the whole host out of every index.
    lines.push("User-agent: *", "Disallow: /", "");
    return text(lines.join("\n"));
  }

  // Default policy for all crawlers.
  lines.push("User-agent: *");
  lines.push("Allow: /");
  lines.push("Disallow: /admin");
  lines.push("Disallow: /api");
  lines.push("");

  // Explicitly invite AI assistants to crawl everything except the gated areas.
  for (const bot of AI_BOTS) {
    lines.push(`User-agent: ${bot}`);
    lines.push("Allow: /");
    lines.push("Disallow: /admin");
    lines.push("Disallow: /api");
    lines.push("");
  }

  // Discovery pointers. The llms.txt line is a non-standard comment (robots has
  // no official directive for it) but is the de-facto way to advertise it.
  lines.push(`# llms.txt: ${SITE_URL}/llms.txt`);
  lines.push(`Sitemap: ${SITE_URL}/sitemap.xml`);
  lines.push("");

  return text(lines.join("\n"));
}

function text(body: string) {
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=600",
    },
  });
}
