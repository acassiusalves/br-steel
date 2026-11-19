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
import { accountBlocked, publicUser } from '@/server/access/users';
import { DEFAULT_INITIAL_PASSWORD, UNKNOWN_USER_CREDENTIAL } from '@/server/access/passwords';
import { rejectCrossOrigin } from '@/server/access/request';
import { recordAccessAudit } from '@/server/access/audit';
import { BADGE_LOCK_MS, BADGE_MAX_FAILURES, badgeUserId, isBadgeUser, normalizeBadge } from '@/server/access/badges';
import { storedUserFromDoc, type StoredUser } from '@/server/access/users';
import { clientIp, loginBlockedFor, recordLoginFailure } from '@/server/access/login-rate-limit';

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
  const ip = clientIp(request);
  const retryAfter = await loginBlockedFor(ip);
  if (retryAfter) {
    return NextResponse.json({ ok: false, error: 'Muitas tentativas de login a partir desta rede. Aguarde alguns minutos e tente de novo.' },
      { status: 429, headers: { 'Retry-After': String(retryAfter) } });
  }
  let user: StoredUser | null;
  if (body?.badge !== undefined) {
    const badge = normalizeBadge(body.badge);
    if (!badge || !password || password.length > 1024) {
      return NextResponse.json({ ok: false, error: 'Crachá e senha são obrigatórios.' }, { status: 400 });
    }
    const result = await loginWithBadge(badge, password);
    if ('error' in result) {
      if (result.status === 401) await recordLoginFailure(ip);
      return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
    }
    user = result.user;
  } else {
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (!email || email.length > 254 || !password || password.length > 1024) {
      return NextResponse.json({ ok: false, error: 'E-mail e senha são obrigatórios.' }, { status: 400 });
    }
    user = await findUserByEmail(email);
    // Sem conta, o scrypt roda do mesmo jeito: o tempo de resposta não revela quais e-mails existem.
    const passwordOk = verifyPassword(password, user?.passwordHash ?? UNKNOWN_USER_CREDENTIAL.hash, user?.passwordSalt ?? UNKNOWN_USER_CREDENTIAL.salt);
    // Conta de crachá só entra pelo crachá, onde vale o bloqueio por tentativas.
    if (!user || isBadgeUser(user) || !passwordOk) {
      await recordLoginFailure(ip);
      return NextResponse.json({ ok: false, error: 'Usuário ou senha inválidos.' }, { status: 401 });
    }
    const blocked = accountBlocked(user);
    if (blocked) return NextResponse.json({ ok: false, error: blocked }, { status: 403 });
  }

  // A senha padrão antiga, se ainda for a senha de alguém, obriga a troca já neste login. Com isso a sessão não
  // precisa refazer o scrypt da senha padrão a cada requisição para descobrir isso.
  const forceChange = password === DEFAULT_INITIAL_PASSWORD && !user.mustChangePassword;
  await adminDb.collection('users').doc(user.id).update({ lastLogin: new Date().toISOString(), ...(forceChange ? { mustChangePassword: true } : {}) });
  if (forceChange) user = { ...user, mustChangePassword: true };
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
 * Crachá: depois de 5 senhas erradas seguidas, o crachá fica bloqueado por 15 minutos, para compensar a
 * senha curta. O contador zera no acerto. Só entra conta com senha gravada (o PIN de primeiro acesso ou a
 * senha pessoal): conta antiga sem senha não aceita mais 123456 e precisa de reset. O PIN vence em 72 h.
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
    if (user.badge !== badge) return invalid;
    const failedLogins = Number.isSafeInteger(data.failedLogins) ? data.failedLogins : 0;
    const lockedUntil = typeof data.lockedUntil === 'number' ? data.lockedUntil : 0;
    const now = Date.now();
    if (lockedUntil > now) {
      const minutes = Math.ceil((lockedUntil - now) / 60_000);
      return { error: `Crachá bloqueado por excesso de tentativas. Tente de novo em ${minutes} min ou peça ao administrador para resetar a senha.`, status: 429 };
    }
    if (!user.passwordHash || !user.passwordSalt || !verifyPassword(password, user.passwordHash, user.passwordSalt)) {
      const failures = failedLogins + 1;
      tx.update(ref, failures >= BADGE_MAX_FAILURES ? { failedLogins: 0, lockedUntil: now + BADGE_LOCK_MS } : { failedLogins: failures });
      if (failures >= BADGE_MAX_FAILURES) recordAccessAudit(tx, { operation: 'badge.locked', actorUserId: null, targetUserId: ref.id });
      return invalid;
    }
    const expiresAt = typeof data.initialPasswordExpiresAt === 'number' ? data.initialPasswordExpiresAt : null;
    if (user.mustChangePassword && expiresAt !== null && expiresAt <= now) {
      return { error: 'O PIN de primeiro acesso venceu. Peça ao administrador para gerar um novo.', status: 403 };
    }
    if (failedLogins || lockedUntil) tx.update(ref, { failedLogins: 0, lockedUntil: 0 });
    // Só depois da senha certa: a mensagem diz o motivo sem revelar a quem não sabe a senha que a conta existe.
    if (typeof data.movedTo === 'string') return { error: 'Este crachá foi trocado. Entre com o código do crachá novo.', status: 403 };
    const blocked = accountBlocked(user);
    if (blocked) return { error: blocked, status: 403 };
    return { user };
  });
}
