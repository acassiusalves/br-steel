import 'server-only';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { keyedDigest } from '@/lib/server-auth';

/**
 * Limite de tentativas de login por endereço de rede, somado ao bloqueio por crachá. Sem ele, dá para testar a
 * mesma senha em todos os crachás (uma tentativa em cada) ou bloquear de propósito os crachás dos líderes.
 * Os terminais da fábrica saem pelo mesmo endereço; os limites cabem com folga num início de turno.
 */
export const LOGIN_LIMITS = [
  { windowMs: 60_000, max: 20 },
  { windowMs: 60 * 60_000, max: 200 },
] as const;

/** Na Vercel, `x-forwarded-for` é preenchido pela plataforma; o primeiro item é o cliente. */
export function clientAddress(request: Request) {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || request.headers.get('x-real-ip')?.trim() || 'desconhecido';
}

/**
 * Conta a tentativa em cada janela. Devolve em quantos segundos tentar de novo quando alguma janela passou do
 * limite, ou null. O incremento atômico não disputa transação: tentativas simultâneas não falham por contenção.
 * O documento guarda só o HMAC do endereço e expira pela política de TTL de `expiresAt`.
 */
export async function consumeLoginAttempt(request: Request, now = Date.now()): Promise<number | null> {
  const address = clientAddress(request);
  const waits = await Promise.all(LOGIN_LIMITS.map(async ({ windowMs, max }) => {
    const window = Math.floor(now / windowMs);
    const ref = adminDb.collection('loginRateLimits').doc(keyedDigest(JSON.stringify(['login', address, windowMs, window])));
    await ref.set({ count: FieldValue.increment(1), expiresAt: Timestamp.fromMillis((window + 2) * windowMs) }, { merge: true });
    const count = Number((await ref.get()).data()?.count ?? 0);
    return count > max ? Math.max(1, Math.ceil(((window + 1) * windowMs - now) / 1000)) : 0;
  }));
  const wait = Math.max(...waits);
  return wait > 0 ? wait : null;
}
