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
    
    // Set a cookie that expires in 365 days
    response.cookies.set({
      name: 'app_access_code',
      value: cleanCode,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 365, // 1 year
      path: '/',
    });

    return response;
  } catch (error) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
