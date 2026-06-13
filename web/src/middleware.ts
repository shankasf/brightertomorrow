import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Admin lives at admin.brightertomorrowtherapy.com, served by THIS Next.js
// app under /admin/*. The subdomain is just a different hostname pointing at
// the same backend — the URL path stays /admin/login, /admin/contacts, etc.
//
// On the root domain, redirect /admin page requests to the subdomain so admin
// work always happens on its own host (cookie isolation, future WAF).
// /admin/api/* is left alone so any legacy caller still reaches the Go gateway
// directly. Env-driven; the host.startsWith('admin.') check below is
// domain-agnostic.
const ADMIN_SUBDOMAIN =
  process.env.ADMIN_HOST_URL || 'https://admin.brightertomorrowtherapy.com'

// ── Per-IP rate limiting for the public blog section ─────────────────────────
// The blog (/blog, /blog/<slug>, /category/<slug>) is read-only marketing
// content with 150+ pages — an attractive scrape/DoS target. Cap each client
// IP to BLOG_LIMIT page requests per BLOG_WINDOW. Mirrors the Go gateway's
// httprate.LimitByIP(N, time.Minute) convention. In-memory fixed window: the
// web deployment runs a single replica, so this state is authoritative; it
// resets on pod restart (acceptable for abuse mitigation, not billing).
const BLOG_LIMIT = 60
const BLOG_WINDOW_MS = 60_000
const blogHits = new Map<string, { count: number; windowStart: number }>()

function clientIp(request: NextRequest): string {
  const xff = request.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  return request.headers.get('x-real-ip') || 'unknown'
}

// Verified-bot allowlist for the blog rate limiter. The limit is abuse
// mitigation (scrape/DoS), NOT a security control, so a header-only User-Agent
// check is sufficient here — we intentionally do NOT do reverse-DNS / IP
// verification. Legitimate search & social crawlers can hammer the 150+ blog
// pages during a recrawl; rate-limiting them would silently drop SEO traffic.
const SEARCH_BOT_UA =
  /Googlebot|bingbot|Slurp|DuckDuckBot|Applebot|facebookexternalhit|LinkedInBot|Twitterbot/i

function isVerifiedBot(request: NextRequest): boolean {
  return SEARCH_BOT_UA.test(request.headers.get('user-agent') || '')
}

function blogRateLimited(request: NextRequest): boolean {
  // Never rate-limit verified search/social bots (see SEARCH_BOT_UA note).
  if (isVerifiedBot(request)) return false
  const ip = clientIp(request)
  const now = Date.now()
  const e = blogHits.get(ip)
  if (!e || now - e.windowStart >= BLOG_WINDOW_MS) {
    blogHits.set(ip, { count: 1, windowStart: now })
    // Opportunistic prune so the map can't grow unbounded.
    if (blogHits.size > 5000) {
      for (const [k, v] of blogHits) {
        if (now - v.windowStart >= BLOG_WINDOW_MS) blogHits.delete(k)
      }
    }
    return false
  }
  e.count += 1
  return e.count > BLOG_LIMIT
}

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl
  const host = request.headers.get('host') || ''
  const isAdminHost = host.startsWith('admin.')

  // Rate-limit the public blog section (skip the admin host, which has its own
  // auth and serves /admin/content/blog editing, not the public articles).
  if (
    !isAdminHost &&
    (pathname === '/blog' ||
      pathname.startsWith('/blog/') ||
      pathname.startsWith('/category/')) &&
    blogRateLimited(request)
  ) {
    return new NextResponse('Too Many Requests', {
      status: 429,
      headers: { 'Retry-After': '60', 'Cache-Control': 'no-store' },
    })
  }

  // On the admin subdomain, redirect root to /admin/login (the explicit entry
  // point). Sub-paths are rewritten to /admin/* by next.config.mjs `rewrites()`;
  // middleware just sets x-pathname so the root layout sees the rewritten path
  // and skips the public chrome.
  if (isAdminHost) {
    if (pathname === '/') {
      return NextResponse.redirect(new URL('/admin/login', request.url), 302)
    }
    if (!pathname.startsWith('/admin')) {
      const newPath = `/admin${pathname}`
      const requestHeaders = new Headers(request.headers)
      requestHeaders.set('x-pathname', newPath)
      return NextResponse.next({ request: { headers: requestHeaders } })
    }
  }

  if (
    !isAdminHost &&
    (pathname === '/admin' ||
      (pathname.startsWith('/admin/') && !pathname.startsWith('/admin/api/')))
  ) {
    return NextResponse.redirect(ADMIN_SUBDOMAIN + pathname + (search || ''), 302)
  }

  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-pathname', pathname)
  return NextResponse.next({ request: { headers: requestHeaders } })
}

export const config = {
  matcher: [
    '/',
    '/((?!_next/static|_next/image|favicon\\.ico).*)',
  ],
}
