import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  // If no IPs are configured in .env, we allow all traffic to prevent locking out the user
  const whitelistedIpsRaw = process.env.WHITELISTED_IPS;
  if (!whitelistedIpsRaw) {
    return NextResponse.next();
  }

  // Parse the comma-separated list of IPs
  const whitelistedIps = whitelistedIpsRaw
    .split(',')
    .map((ip) => ip.trim())
    .filter(Boolean);

  // If the variable is present but empty, we still allow to be safe (or you can choose to block)
  if (whitelistedIps.length === 0) {
    return NextResponse.next();
  }

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
    
    // Return a 403 Forbidden response with a clean error message
    return new NextResponse(
      JSON.stringify({ 
        error: "Access Denied", 
        message: "Your IP address is not whitelisted.",
        yourIp: ip 
      }), 
      {
        status: 403,
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );
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
