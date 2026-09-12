import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizationIdSchema, establishConsentSession } from '@/server/oauth/consent';
import { bridgeCookieHeader } from '@/server/oauth/cookies';
import { oauthJson, readOAuthBody } from '@/server/oauth/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  return oauthJson(async () => {
    const { authorization_id } = z.object({ authorization_id: authorizationIdSchema }).parse(await readOAuthBody(request));
    const cookie = await establishConsentSession(request, authorization_id);
    return NextResponse.json({ ok: true }, { headers: { 'Set-Cookie': bridgeCookieHeader(cookie) } });
  });
}
