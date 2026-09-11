import { NextResponse } from 'next/server';
import { authorizationIdSchema, getAuthorization } from '@/server/oauth/consent';
import { oauthJson } from '@/server/oauth/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  return oauthJson(async () => {
    const id = authorizationIdSchema.parse(new URL(request.url).searchParams.get('authorization_id'));
    return NextResponse.json({ ok: true, ...await getAuthorization(request, id) });
  });
}
