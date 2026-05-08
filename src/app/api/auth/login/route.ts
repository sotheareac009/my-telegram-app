import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function POST(request: Request) {
  try {
    const { code } = await request.json();

    if (!code || typeof code !== 'string') {
      return NextResponse.json({ error: "Access code is required" }, { status: 400 });
    }

    const cleanCode = code.trim();

    // Check Supabase for the access code
    const { data: accessCode, error: dbError } = await supabase
      .from('access_codes')
      .select('id, is_active')
      .eq('code', cleanCode)
      .single();

    if (dbError || !accessCode) {
      return NextResponse.json({ error: "Invalid access code" }, { status: 401 });
    }

    if (!accessCode.is_active) {
      return NextResponse.json({ error: "This access code has been revoked" }, { status: 403 });
    }

    // Create the response and set the cookie
    const response = NextResponse.json({ success: true });

    // Only mark Secure when the request is actually HTTPS, so the same code
    // works on localhost, tigram.com, or any other host over plain HTTP in dev,
    // and still sets Secure correctly when deployed behind HTTPS (including
    // reverse proxies that terminate TLS upstream).
    const proto =
      request.headers.get('x-forwarded-proto') ??
      new URL(request.url).protocol.replace(':', '');
    const isHttps = proto === 'https';

    // Set a cookie that expires in 365 days
    response.cookies.set({
      name: 'app_access_code',
      value: cleanCode,
      httpOnly: true,
      secure: isHttps,
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 365, // 1 year
      path: '/',
    });

    console.log(
      `[Login] code='${cleanCode}' host=${request.headers.get('host')} proto=${proto} isHttps=${isHttps} → Set-Cookie sent`
    );
    console.log(`[Login] response Set-Cookie header:`, response.headers.get('set-cookie'));

    return response;
  } catch (error) {
    console.error('[Login] EXCEPTION:', error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
