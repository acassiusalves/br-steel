import { clearBridgeCookieHeader } from '@/server/oauth/cookies';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { adminDb } from '@/lib/firebase-admin';
import { getSessionFromRequest, hashPassword, sessionCookieHeader, createSessionToken, verifyPassword } from '@/lib/server-auth';
import { needsPasswordChange } from '@/server/access/passwords';
import { isKnownRole, publicUser, storedUserFromDoc } from '@/server/access/users';
import { rejectCrossOrigin } from '@/server/access/request';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const passwordInput = z.string().max(1024).nullish().transform(value => value ?? '');
const profileInput = z.object({
  name: z.string().trim().min(1).max(120),
  currentPassword: passwordInput,
  newPassword: passwordInput,
});

export async function PATCH(request: Request) {
  const originError = rejectCrossOrigin(request);
  if (originError) return originError;
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });

  const parsed = profileInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Nome ou senha inválidos.' }, { status: 400 });
  const { name, currentPassword, newPassword } = parsed.data;
  if (newPassword && newPassword.length < 12) {
    return NextResponse.json({ ok: false, error: 'A nova senha deve ter pelo menos 12 caracteres.' }, { status: 400 });
  }
  const credential = newPassword ? hashPassword(newPassword) : null;
  const ref = adminDb.collection('users').doc(session.user.id);
  const result = await adminDb.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    const stored = snapshot.exists ? storedUserFromDoc(snapshot.id, snapshot.data()!) : null;
    if (!stored || stored.active === false || !isKnownRole(stored.role) || stored.authVersion !== session.authVersion) {
      return { error: 'Sessão expirada.', status: 401 } as const;
    }
    const mustChange = needsPasswordChange(stored);
    if (mustChange && !newPassword) return { error: 'Cadastre uma nova senha para concluir o primeiro acesso.', status: 400 } as const;
    if (newPassword && !mustChange && !verifyPassword(currentPassword, stored.passwordHash, stored.passwordSalt)) {
      return { error: 'Senha atual inválida.', status: 401 } as const;
    }
    const update = {
      name, updatedAt: new Date().toISOString(),
      ...(credential ? {
        passwordHash: credential.hash, passwordSalt: credential.salt,
        mustChangePassword: false, authVersion: stored.authVersion + 1,
      } : {}),
    };
    transaction.update(ref, update);
    return { user: { ...stored, ...update } };
  });
  if ('error' in result) return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  const response = NextResponse.json({ ok: true, user: publicUser(result.user) });
  response.headers.set('Set-Cookie', sessionCookieHeader(createSessionToken(result.user, result.user.authVersion)));
  response.headers.set('Cache-Control', 'no-store');
  if (newPassword) response.headers.append('Set-Cookie', clearBridgeCookieHeader());
  return response;
}
