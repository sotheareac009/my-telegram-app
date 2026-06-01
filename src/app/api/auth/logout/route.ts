import { NextResponse } from 'next/server';

export async function POST() {
  const response = NextResponse.json({ success: true });
  response.cookies.set({
    name: 'app_access_code',
    value: '',
    httpOnly: true,
    maxAge: 0,
    path: '/',
  });
  return response;
}
