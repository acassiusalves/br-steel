import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizationIdSchema, decideAuthorization } from '@/server/oauth/consent';
import { oauthJson, readOAuthBody } from '@/server/oauth/http';
const schema = z.object({ authorization_id: authorizationIdSchema, decision: z.enum(['approve', 'deny']),
  capabilities: z.array(z.enum(['vendas:read', 'vendas:sync', 'estoque:read', 'insumos:read', 'insumos:write', 'producao:read', 'producao:write'])).max(7).default([]) }).strict();
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  return oauthJson(async () => {
    const data = schema.parse(await readOAuthBody(request));
    return NextResponse.json({ ok: true, redirectUrl: await decideAuthorization(request, data.authorization_id, data.decision, data.capabilities) });
  });
}
