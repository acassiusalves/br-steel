import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOAuthUser } from '@/server/oauth/consent';
import { listOwnedConnections, revokeOwnedConnection } from '@/server/oauth/grants';
import { oauthJson, readOAuthBody } from '@/server/oauth/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  return oauthJson(async () => {
    const local = await requireOAuthUser(request);
    return NextResponse.json({ ok: true, connections: await listOwnedConnections(local.user.id) });
  });
}
export async function DELETE(request: Request) {
  return oauthJson(async () => {
    const { connection_id } = z.object({ connection_id: z.string().regex(/^[a-f0-9]{64}$/) }).strict().parse(await readOAuthBody(request));
    const local = await requireOAuthUser(request);
    await revokeOwnedConnection(connection_id, local);
    return NextResponse.json({ ok: true });
  });
}
