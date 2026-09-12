import { clearBridgeCookieHeader } from '@/server/oauth/cookies';
import { NextResponse } from 'next/server';
import { clearSessionCookieHeader } from '@/lib/server-auth';
import { rejectCrossOrigin } from '@/server/access/request';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const originError = rejectCrossOrigin(request);
  if (originError) return originError;
  const response = NextResponse.json({ ok: true });
  response.headers.set('Set-Cookie', clearSessionCookieHeader());
  response.headers.append('Set-Cookie', clearBridgeCookieHeader());
  return response;
}
