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
import {
  BADGE_INITIAL_PASSWORD_EXPIRED, BADGE_LOCK_MS, BADGE_MAX_FAILURES, badgeUserId, isBadgeUser, normalizeBadge,
} from '@/server/access/badges';
import { storedUserFromDoc, type StoredUser } from '@/server/access/users';
import { consumeLoginAttempt } from '@/server/access/login-rate-limit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request) {
  const originError = rejectCrossOrigin(request);
  if (originError) return originError;
  // Limite por endereço antes de qualquer leitura: impede testar a mesma senha em todos os crachás.
  const retryAfter = await consumeLoginAttempt(request);
  if (retryAfter) {
    return NextResponse.json({ ok: false, error: 'Muitas tentativas de login deste endereço. Aguarde e tente novamente.' },
      { status: 429, headers: { 'Retry-After': String(retryAfter), 'Cache-Control': 'no-store' } });
  }
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
 * Crachá: depois de 5 senhas erradas seguidas, o crachá fica bloqueado por 15 minutos. O contador zera no
 * acerto. A conta só entra com senha gravada: o PIN inicial (válido por 72 h) ou a senha pessoal. Conta antiga
 * sem senha gravada não entra mais com 123456; o administrador reseta e entrega um PIN novo.
 */
async function loginWithBadge(badge: string, password: string): Promise<{ user: StoredUser } | { error: string; status: number }> {
  const invalid = { error: 'Crachá ou senha inválidos.', status: 401 } as const;
  const ref = adminDb.collection('users').doc(badgeUserId(badge));
  // Leitura, verificação e contador na mesma transação: tentativas simultâneas não perdem incrementos
  // e não passam do limite de 5.
  return adminDb.runTransaction(async tx => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) return invalid;
    const data = snapshot.data()!;
    const user = storedUserFromDoc(snapshot.id, data);
    if (user.badge !== badge || user.active === false || !isKnownRole(user.role)) return invalid;
    const failedLogins = Number.isSafeInteger(data.failedLogins) ? data.failedLogins : 0;
    const lockedUntil = typeof data.lockedUntil === 'number' ? data.lockedUntil : 0;
    const now = Date.now();
    if (lockedUntil > now) {
      const minutes = Math.ceil((lockedUntil - now) / 60_000);
      return { error: `Crachá bloqueado por excesso de tentativas. Tente de novo em ${minutes} min ou peça ao administrador para resetar a senha.`, status: 429 };
    }
    const hasPassword = !!user.passwordHash && !!user.passwordSalt;
    if (!hasPassword || !verifyPassword(password, user.passwordHash, user.passwordSalt)) {
      const failures = failedLogins + 1;
      tx.update(ref, failures >= BADGE_MAX_FAILURES ? { failedLogins: 0, lockedUntil: now + BADGE_LOCK_MS } : { failedLogins: failures });
      return invalid;
    }
    if (failedLogins || lockedUntil) tx.update(ref, { failedLogins: 0, lockedUntil: 0 });
    const expiresAt = typeof data.initialPasswordExpiresAt === 'number' ? data.initialPasswordExpiresAt : null;
    if (user.mustChangePassword && expiresAt !== null && expiresAt <= now) return { error: BADGE_INITIAL_PASSWORD_EXPIRED, status: 401 };
    return { user };
  });
}
