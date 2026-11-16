import 'server-only';
import { createHash } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';

/**
 * Limite de senhas erradas por IP, somando crachá e e-mail. O bloqueio por conta (5 tentativas no crachá)
 * não impede alguém de testar uma senha em muitos crachás; este limite impede. Conta só as falhas, para
 * não travar os terminais da fábrica, que saem pelo mesmo IP. O contador fica no Firestore (coleção
 * fechada ao cliente pelas regras) e vale entre instâncias; o IP entra só como hash.
 */
export const LOGIN_FAILURES_PER_WINDOW = 20;
export const LOGIN_WINDOW_MS = 15 * 60_000;

export function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || request.headers.get('x-real-ip')?.trim() || 'desconhecido';
}

const counterRef = (ip: string, window: number) =>
  adminDb.collection('loginRateLimits').doc(createHash('sha256').update(JSON.stringify(['login', ip, window])).digest('hex'));

/** Segundos até liberar, quando o IP passou do limite na janela atual; null quando pode tentar. */
export async function loginBlockedFor(ip: string, now = Date.now()): Promise<number | null> {
  const window = Math.floor(now / LOGIN_WINDOW_MS);
  const snapshot = await counterRef(ip, window).get();
  const count = snapshot.exists ? Number(snapshot.data()!.count) : 0;
  return count >= LOGIN_FAILURES_PER_WINDOW ? Math.max(1, Math.ceil(((window + 1) * LOGIN_WINDOW_MS - now) / 1000)) : null;
}

export async function recordLoginFailure(ip: string, now = Date.now()): Promise<void> {
  const window = Math.floor(now / LOGIN_WINDOW_MS);
  const ref = counterRef(ip, window);
  await adminDb.runTransaction(async tx => {
    const snapshot = await tx.get(ref);
    const count = snapshot.exists && Number.isSafeInteger(snapshot.data()!.count) ? snapshot.data()!.count : 0;
    tx.set(ref, { count: count + 1, expiresAt: Timestamp.fromMillis((window + 2) * LOGIN_WINDOW_MS) });
  }, { maxAttempts: 5 });
}
