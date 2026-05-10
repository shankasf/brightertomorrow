import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Admin lives at admin.brightertomorrowtherapy.cloud, served by THIS Next.js
// app under /admin/*. The subdomain is just a different hostname pointing at
// the same backend — the URL path stays /admin/login, /admin/contacts, etc.
//
// On the root domain (brightertomorrowtherapy.cloud), redirect /admin page
// requests to the subdomain so admin work always happens on its own host
// (cookie isolation, future WAF). /admin/api/* is left alone so any legacy
// caller still reaches the Go gateway directly.
const ADMIN_SUBDOMAIN = 'https://admin.brightertomorrowtherapy.cloud'

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl
  const host = request.headers.get('host') || ''
  const isAdminHost = host.startsWith('admin.')

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
