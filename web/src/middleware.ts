import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Canonical admin lives at admin.brightertomorrowtherapy.cloud (S3 + Cognito).
// We're retiring the path-based admin under brightertomorrowtherapy.cloud/admin/*,
// so redirect any *page* request there to the subdomain. /admin/api/* is left
// alone — it still routes to the Go gateway via Traefik for any legacy caller.
const ADMIN_SUBDOMAIN = 'https://admin.brightertomorrowtherapy.cloud'

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl

  if (pathname === '/admin' || (pathname.startsWith('/admin/') && !pathname.startsWith('/admin/api/'))) {
    // Strip /admin from the path; /admin/login → /login on the subdomain.
    const tail = pathname === '/admin' ? '' : pathname.slice('/admin'.length)
    return NextResponse.redirect(ADMIN_SUBDOMAIN + tail + (search || ''), 302)
  }

  // Default: forward x-pathname so the root layout can detect special routes
  // (kept for any future path-based gating).
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-pathname', pathname)
  return NextResponse.next({ request: { headers: requestHeaders } })
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon\\.ico).*)'],
}
