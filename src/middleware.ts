import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow requests to auth, admin routes, and static assets
  if (
    pathname === '/auth' || 
    pathname === '/api/auth/login' || 
    pathname.startsWith('/admin') ||
    pathname.startsWith('/api/admin')
  ) {
    return NextResponse.next();
  }

  // Extract client IP for tracking
  let ip = request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip') ?? 'Unknown';
  if (ip.includes(',')) {
    ip = ip.split(',')[0].trim();
  }

  // Always allow localhost during development 
  if (ip === '127.0.0.1' || ip === '::1' || ip === 'localhost') {
    return NextResponse.next();
  }

  // Check for the auth cookie
  const authCookie = request.cookies.get('app_access_code')?.value;

  if (!authCookie) {
    const url = request.nextUrl.clone();
    url.pathname = '/auth';
    return NextResponse.rewrite(url);
  }

  // Verify the code against Supabase using REST API (faster for Edge middleware)
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      // If DB is not configured yet, let it pass or block depending on strictness.
      // We block to be safe.
      const url = request.nextUrl.clone();
      url.pathname = '/auth';
      return NextResponse.rewrite(url);
    }

    const res = await fetch(`${supabaseUrl}/rest/v1/access_codes?code=eq.${authCookie}&is_active=eq.true&select=id`, {
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`
      }
    });

    const data = await res.json();

    if (!data || data.length === 0) {
      console.log(`[Auth] Blocked request from IP: ${ip} (Revoked or invalid code: ${authCookie})`);
      const url = request.nextUrl.clone();
      url.pathname = '/auth';
      return NextResponse.rewrite(url);
    }

    // Valid code! Log it.
    if (!pathname.startsWith('/_next') && !pathname.includes('.')) {
      console.log(`[Auth] Code '${authCookie}' used by IP ${ip} to access ${pathname}`);
    }

  } catch (error) {
    console.error("Middleware DB check failed", error);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|public/).*)',
  ],
};
