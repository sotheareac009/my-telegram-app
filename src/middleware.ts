import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow requests to the auth API route and auth page
  if (pathname === '/auth' || pathname === '/api/auth/login') {
    return NextResponse.next();
  }

  // Get configured access codes
  const accessCodesRaw = process.env.ACCESS_CODES || "";
  const validCodes = accessCodesRaw
    .split(',')
    .map((code) => code.trim())
    .filter(Boolean);

  // If no codes are configured at all, we could choose to allow or block.
  // We will default to block to be safe. But localhost is usually allowed.
  
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

  // Verify the code
  if (!authCookie || !validCodes.includes(authCookie)) {
    console.log(`[Auth] Blocked request from IP: ${ip} (Invalid or missing code: ${authCookie})`);
    
    // Redirect unauthenticated users to the auth page
    const url = request.nextUrl.clone();
    url.pathname = '/auth';
    return NextResponse.rewrite(url);
  }

  // If valid, log the successful access for tracking sharing
  // (We log periodically or per request, here per request path)
  if (!pathname.startsWith('/_next') && !pathname.includes('.')) {
    console.log(`[Auth] Code '${authCookie}' used by IP ${ip} to access ${pathname}`);
  }

  return NextResponse.next();
}

// Apply this middleware to all paths except static assets
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|public/).*)',
  ],
};
