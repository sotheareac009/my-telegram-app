import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const { code } = await request.json();

    if (!code || typeof code !== 'string') {
      return NextResponse.json({ error: "Access code is required" }, { status: 400 });
    }

    const accessCodesRaw = process.env.ACCESS_CODES || "";
    const validCodes = accessCodesRaw
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean);

    if (!validCodes.includes(code.trim())) {
      return NextResponse.json({ error: "Invalid access code" }, { status: 401 });
    }

    // Create the response and set the cookie
    const response = NextResponse.json({ success: true });
    
    // Set a cookie that expires in 365 days
    response.cookies.set({
      name: 'app_access_code',
      value: code.trim(),
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
