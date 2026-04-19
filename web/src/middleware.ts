import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Sets x-pathname header so the root layout can detect /admin routes
// and skip the public site chrome (header, footer, chat widget).
export function middleware(request: NextRequest) {
  const response = NextResponse.next()
  response.headers.set('x-pathname', request.nextUrl.pathname)
  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon\\.ico).*)'],
}
