import 'server-only';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { DEFAULT_INITIAL_PASSWORD } from './passwords';
import { storedUserFromDoc, type StoredUser } from './users';

/**
 * Acesso pelo crachá, como no iApp: o funcionário entra com o código do crachá e uma senha, sem e-mail.
 * A conta nasce sem senha gravada; no primeiro acesso, e depois de cada reset feito pelo administrador,
 * a senha é 123456 e o sistema obriga a cadastrar uma senha pessoal antes de liberar as telas.
 */
export const BADGE_MIN_PASSWORD = 6;
export const BADGE_MAX_FAILURES = 5;
export const BADGE_LOCK_MS = 15 * 60_000;
export const BADGE_INITIAL_PASSWORD = DEFAULT_INITIAL_PASSWORD;

/** Códigos do crachá: letras, números e hífen, sem diferença entre maiúsculas e minúsculas. */
export function normalizeBadge(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const badge = raw.trim().toUpperCase();
  return /^[A-Z0-9-]{1,40}$/.test(badge) ? badge : null;
}
/** O id do documento deriva do crachá: dois funcionários não podem ter o mesmo código. */
export const badgeUserId = (badge: string) => `cracha-${badge.toLowerCase()}`;
export const isBadgeUser = (user: Pick<StoredUser, 'badge'>) => typeof user.badge === 'string' && user.badge.length > 0;

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
  /** Cria a conta do crachá (papel Operador, sem senha gravada) ou devolve a que já existe para o mesmo crachá. */
  create(name: string, badge: string): Promise<{ userId: string }>;
  /** Volta a conta para o primeiro acesso: senha 123456, troca obrigatória e sessões abertas encerradas. */
  reset(userId: string): Promise<void>;
};

export const firestoreBadgeAccounts: BadgeAccounts = {
  async create(name, badge) {
    const ref = adminDb.collection('users').doc(badgeUserId(badge));
    await adminDb.runTransaction(async tx => {
      const current = await tx.get(ref);
      if (current.exists) {
        if (current.data()!.badge !== badge) throw new Error('Já existe outra conta com este código de crachá.');
        return;
      }
      tx.create(ref, {
        name, badge, role: 'Operador', active: true, mustChangePassword: true, authVersion: 0,
        failedLogins: 0, lockedUntil: 0, createdAt: new Date().toISOString(),
      });
    });
    return { userId: ref.id };
  },
  async reset(userId) {
    const ref = adminDb.collection('users').doc(userId);
    await adminDb.runTransaction(async tx => {
      const current = await tx.get(ref);
      const data = current.data();
      if (!current.exists || typeof data?.badge !== 'string' || !data.badge) throw new Error('Este funcionário não entra pelo crachá.');
      const authVersion = Number.isSafeInteger(data.authVersion) ? data.authVersion : 0;
      tx.update(ref, {
        passwordHash: FieldValue.delete(), passwordSalt: FieldValue.delete(), mustChangePassword: true,
        authVersion: authVersion + 1, failedLogins: 0, lockedUntil: 0, updatedAt: new Date().toISOString(),
      });
    });
  },
};
