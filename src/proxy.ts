import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public landing page, auth, admin, and static assets
  if (
    pathname === '/' ||
    pathname === '/auth' ||
    pathname === '/api/auth/login' ||
    pathname.startsWith('/admin') ||
    pathname.startsWith('/api/admin')
  ) {
    return NextResponse.next();
  }

  // Trust the cookie — it can only have been set by /api/auth/login, which
  // already validated the code against Supabase. Avoids per-request DB
  // round-trips and works over plain HTTP / custom hostnames.
  // Revocation takes effect the next time the user signs in (cookie expires
  // in 1 year by default; shorten the maxAge in the login route if needed).
  if (!request.cookies.get('app_access_code')?.value) {
    const url = request.nextUrl.clone();
    url.pathname = '/auth';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

// config is defined in middleware.ts (Next.js requires it inline there)
