import { NextResponse } from 'next/server';
import { clearSessionCookieHeader } from '@/lib/server-auth';

export const dynamic = 'force-dynamic';

export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.headers.set('Set-Cookie', clearSessionCookieHeader());
  return response;
}
