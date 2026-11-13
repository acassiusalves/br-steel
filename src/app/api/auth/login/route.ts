import { clearBridgeCookieHeader } from '@/server/oauth/cookies';
import { NextResponse } from 'next/server';
import {
  createSessionToken,
  findUserByEmail,
  loadAppAccessSettings,
  sessionCookieHeader,
  verifyPassword,
} from '@/lib/server-auth';
import { adminDb } from '@/lib/firebase-admin';
import { isKnownRole, publicUser } from '@/server/access/users';
import { rejectCrossOrigin } from '@/server/access/request';
import { BADGE_LOCK_MS, BADGE_MAX_FAILURES, badgeUserId, findUserByBadge, isBadgeUser, normalizeBadge } from '@/server/access/badges';
import type { StoredUser } from '@/server/access/users';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request) {
  const originError = rejectCrossOrigin(request);
  if (originError) return originError;
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'JSON inválido' }, { status: 400 });
  }

  const password = typeof body?.password === 'string' ? body.password : '';
  let user: StoredUser | null;
  if (body?.badge !== undefined) {
    const badge = normalizeBadge(body.badge);
    if (!badge || !password || password.length > 1024) {
      return NextResponse.json({ ok: false, error: 'Crachá e senha são obrigatórios.' }, { status: 400 });
    }
    const result = await loginWithBadge(badge, password);
    if ('error' in result) return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
    user = result.user;
  } else {
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (!email || email.length > 254 || !password || password.length > 1024) {
      return NextResponse.json({ ok: false, error: 'E-mail e senha são obrigatórios.' }, { status: 400 });
    }
    user = await findUserByEmail(email);
    // Conta de crachá só entra pelo crachá, onde vale o bloqueio por tentativas.
    if (!user || isBadgeUser(user) || user.active === false || !isKnownRole(user.role) || !verifyPassword(password, user.passwordHash, user.passwordSalt)) {
      return NextResponse.json({ ok: false, error: 'Usuário ou senha inválidos.' }, { status: 401 });
    }
  }

  await adminDb.collection('users').doc(user.id).update({ lastLogin: new Date().toISOString() });
  const token = createSessionToken(user, user.authVersion);
  const access = await loadAppAccessSettings();
  const response = NextResponse.json({
    ok: true,
    user: publicUser(user),
    ...access,
  });
  response.headers.set('Set-Cookie', sessionCookieHeader(token));
  response.headers.set('Cache-Control', 'no-store');
  response.headers.append('Set-Cookie', clearBridgeCookieHeader());
  return response;
}

/**
 * Crachá: depois de 5 senhas erradas seguidas, o crachá fica bloqueado por 15 minutos. Compensa a senha
 * curta e a senha de primeiro acesso conhecida (123456). O contador zera no acerto.
 */
async function loginWithBadge(badge: string, password: string): Promise<{ user: StoredUser } | { error: string; status: number }> {
  const invalid = { error: 'Crachá ou senha inválidos.', status: 401 } as const;
  const user = await findUserByBadge(badge);
  if (!user || user.active === false || !isKnownRole(user.role)) return invalid;
  const now = Date.now();
  if (user.lockedUntil > now) {
    const minutes = Math.ceil((user.lockedUntil - now) / 60_000);
    return { error: `Crachá bloqueado por excesso de tentativas. Tente de novo em ${minutes} min ou peça ao administrador para resetar a senha.`, status: 429 };
  }
  const ref = adminDb.collection('users').doc(badgeUserId(badge));
  if (!verifyPassword(password, user.passwordHash, user.passwordSalt)) {
    const failures = user.failedLogins + 1;
    await ref.update(failures >= BADGE_MAX_FAILURES ? { failedLogins: 0, lockedUntil: now + BADGE_LOCK_MS } : { failedLogins: failures });
    return invalid;
  }
  if (user.failedLogins || user.lockedUntil) await ref.update({ failedLogins: 0, lockedUntil: 0 });
  return { user };
}
