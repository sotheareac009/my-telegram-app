import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  // Prevent infinite loop if already on the access-denied page
  if (request.nextUrl.pathname === '/access-denied') {
    return NextResponse.next();
  }

  // If no IPs are configured, it will default to an empty list and block everyone
  const whitelistedIpsRaw = process.env.WHITELISTED_IPS || "";
  
  // Parse the comma-separated list of IPs
  const whitelistedIps = whitelistedIpsRaw
    .split(',')
    .map((ip) => ip.trim())
    .filter(Boolean);

  // Always allow localhost during development to prevent locking yourself out
  whitelistedIps.push('127.0.0.1', '::1', 'localhost');

  // Extract the client IP from the request headers
  // (In production behind proxies, x-forwarded-for or x-real-ip are usually set)
  let ip = request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip');

  if (ip && ip.includes(',')) {
    ip = ip.split(',')[0].trim();
  }

  // If we can't determine the IP (rare, but happens locally), we allow it to be safe.
  // Otherwise, check if it's in our whitelist.
  if (ip && !whitelistedIps.includes(ip)) {
    console.log(`[Middleware] Blocked request from unauthorized IP: ${ip}`);
    
    // Rewrite to the custom access denied page and pass the IP in headers
    const url = request.nextUrl.clone();
    url.pathname = '/access-denied';
    
    const response = NextResponse.rewrite(url);
    response.headers.set('x-blocked-ip', ip || 'Unknown');
    
    return response;
  }

  return NextResponse.next();
}

// Apply this middleware to all paths except static assets
export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder files
     */
    '/((?!_next/static|_next/image|favicon.ico|public/).*)',
  ],
};
