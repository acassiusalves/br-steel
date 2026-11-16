import 'server-only';
import crypto from 'node:crypto';
import { adminDb } from '@/lib/firebase-admin';
import { PRODUCTION_ROLE } from '@/lib/permissions';
import { DEFAULT_INITIAL_PASSWORD, hashPassword } from './passwords';
import { storedUserFromDoc, type StoredUser } from './users';

/**
 * Acesso pelo crachá, como no iApp: o funcionário entra com o código do crachá e uma senha, sem e-mail.
 * Ao criar o acesso, e a cada reset, o administrador recebe um PIN de 6 dígitos sorteado para aquela
 * pessoa, mostrado uma vez só. O PIN vale para o primeiro acesso por 72 horas, e o sistema obriga a
 * cadastrar uma senha pessoal antes de liberar as telas. A conta nasce com o papel Produção.
 */
export const BADGE_MIN_PASSWORD = 6;
export const BADGE_MAX_FAILURES = 5;
export const BADGE_LOCK_MS = 15 * 60_000;
/** Prazo do PIN de primeiro acesso. */
export const BADGE_PIN_TTL_MS = 72 * 3_600_000;
/** Senha de primeiro acesso das contas antigas: não é mais aceita no crachá e não pode virar senha pessoal. */
export const BADGE_INITIAL_PASSWORD = DEFAULT_INITIAL_PASSWORD;

/** Códigos do crachá: letras, números e hífen, sem diferença entre maiúsculas e minúsculas. Zeros à esquerda contam. */
export function normalizeBadge(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const badge = raw.trim().toUpperCase();
  return /^[A-Z0-9-]{1,40}$/.test(badge) ? badge : null;
}
/** O id do documento deriva do crachá: dois funcionários não podem ter o mesmo código. */
export const badgeUserId = (badge: string) => `cracha-${badge.toLowerCase()}`;
export const isBadgeUser = (user: Pick<StoredUser, 'badge'>) => typeof user.badge === 'string' && user.badge.length > 0;

/** PIN de 6 dígitos sorteado, nunca a senha de primeiro acesso antiga. */
export function generateBadgePin(): string {
  for (;;) {
    const pin = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    if (pin !== BADGE_INITIAL_PASSWORD) return pin;
  }
}

/** Campos que levam a conta ao primeiro acesso com um PIN novo e encerram as sessões abertas. */
function firstAccess(pin: string, authVersion: number, now: number) {
  const { hash, salt } = hashPassword(pin);
  return {
    passwordHash: hash, passwordSalt: salt, mustChangePassword: true, initialPasswordExpiresAt: now + BADGE_PIN_TTL_MS,
    authVersion, failedLogins: 0, lockedUntil: 0,
  };
}

export async function findUserByBadge(raw: unknown): Promise<(StoredUser & { failedLogins: number; lockedUntil: number }) | null> {
  const badge = normalizeBadge(raw);
  if (!badge) return null;
  const doc = await adminDb.collection('users').doc(badgeUserId(badge)).get();
  if (!doc.exists) return null;
  const data = doc.data()!;
  const user = storedUserFromDoc(doc.id, data);
  if (user.badge !== badge) return null;
  return { ...user, failedLogins: Number.isSafeInteger(data.failedLogins) ? data.failedLogins : 0,
    lockedUntil: typeof data.lockedUntil === 'number' ? data.lockedUntil : 0 };
}

export type BadgeAccounts = {
  /**
   * Cria a conta do crachá (papel Produção) com um PIN de primeiro acesso. Se já existe conta para o
   * crachá (de um teste ou de um acesso anterior), ela é reaproveitada do zero: senha, papel, bloqueio e
   * sessões abertas voltam ao primeiro acesso, e `adopted` avisa o administrador.
   */
  create(name: string, badge: string): Promise<{ userId: string; pin: string; adopted: boolean }>;
  /** Volta a conta para o primeiro acesso com um PIN novo, troca obrigatória e sessões abertas encerradas. */
  reset(userId: string): Promise<{ pin: string }>;
};

export const firestoreBadgeAccounts: BadgeAccounts = {
  async create(name, badge) {
    const ref = adminDb.collection('users').doc(badgeUserId(badge));
    const pin = generateBadgePin();
    const adopted = await adminDb.runTransaction(async tx => {
      const current = await tx.get(ref);
      const now = Date.now();
      if (current.exists) {
        const data = current.data()!;
        if (data.badge !== badge) throw new Error('Já existe outra conta com este código de crachá.');
        const authVersion = Number.isSafeInteger(data.authVersion) && data.authVersion >= 0 ? data.authVersion : 0;
        tx.update(ref, { name, role: PRODUCTION_ROLE, active: true, ...firstAccess(pin, authVersion + 1, now), updatedAt: new Date(now).toISOString() });
        return true;
      }
      tx.create(ref, { name, badge, role: PRODUCTION_ROLE, active: true, ...firstAccess(pin, 0, now), createdAt: new Date(now).toISOString() });
      return false;
    });
    return { userId: ref.id, pin, adopted };
  },
  async reset(userId) {
    const ref = adminDb.collection('users').doc(userId);
    const pin = generateBadgePin();
    await adminDb.runTransaction(async tx => {
      const current = await tx.get(ref);
      const data = current.data();
      if (!current.exists || typeof data?.badge !== 'string' || !data.badge) throw new Error('Este funcionário não entra pelo crachá.');
      const authVersion = Number.isSafeInteger(data.authVersion) && data.authVersion >= 0 ? data.authVersion : 0;
      tx.update(ref, { ...firstAccess(pin, authVersion + 1, Date.now()), updatedAt: new Date().toISOString() });
    });
    return { pin };
  },
};
