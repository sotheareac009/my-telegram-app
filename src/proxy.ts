import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Routes that intentionally set a long Cache-Control on their own response
// (photos, thumbnails, media streams). Excluded from the API-wide no-store
// default below so the WebView can still reuse them.
const CACHEABLE_API_PREFIXES = [
  '/api/telegram/thumb',
  '/api/telegram/dialog-photo',
  '/api/telegram/user-photo',
  '/api/telegram/profile-photo',
  '/api/telegram/chat-media',
  '/api/telegram/sticker-file',
  '/api/telegram/download',
];

function applyApiNoStore(res: NextResponse, pathname: string): NextResponse {
  // iOS WKWebView / Android WebView heuristically cache any JSON response
  // that lacks an explicit Cache-Control. Force every JSON API call to
  // revalidate so live data isn't masked by a stale cached copy.
  if (
    pathname.startsWith('/api/') &&
    !CACHEABLE_API_PREFIXES.some((p) => pathname.startsWith(p))
  ) {
    res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  }
  return res;
}

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
    return applyApiNoStore(NextResponse.next(), pathname);
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
    return NextResponse.redirect(url, { status: 302 });
  }

  return applyApiNoStore(NextResponse.next(), pathname);
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|public/).*)',
  ],
};
