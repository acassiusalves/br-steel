import 'server-only';
import crypto from 'node:crypto';
import { adminDb } from '@/lib/firebase-admin';
import { PRODUCTION_ROLE } from '@/lib/permissions';
import { DEFAULT_INITIAL_PASSWORD, hashPassword } from './passwords';
import { recordAccessAudit } from './audit';
import { AccessError } from './errors';
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
   * sessões abertas voltam ao primeiro acesso, e `adopted` avisa o administrador. Conta de administrador
   * nunca é reaproveitada: isso rebaixaria um administrador sem aviso.
   */
  create(name: string, badge: string, actorUserId: string): Promise<{ userId: string; pin: string; adopted: boolean }>;
  /** Volta a conta para o primeiro acesso com um PIN novo e a reativa; as sessões abertas são encerradas. */
  reset(userId: string, actorUserId: string): Promise<{ pin: string }>;
  /** Desativa a conta de crachá e encerra as sessões. Devolve false quando não havia o que desativar. */
  deactivate(userId: string, actorUserId: string): Promise<boolean>;
};

const versionOf = (data: FirebaseFirestore.DocumentData) => (Number.isSafeInteger(data.authVersion) && data.authVersion >= 0 ? data.authVersion : 0);

export const firestoreBadgeAccounts: BadgeAccounts = {
  async create(name, badge, actorUserId) {
    const ref = adminDb.collection('users').doc(badgeUserId(badge));
    const pin = generateBadgePin();
    const adopted = await adminDb.runTransaction(async tx => {
      const current = await tx.get(ref);
      const now = Date.now();
      if (current.exists) {
        const data = current.data()!;
        if (data.badge !== badge) throw new AccessError('Já existe outra conta com este código de crachá.');
        if (data.role === 'Administrador') {
          throw new AccessError('O login deste crachá é de um administrador. Troque o papel em Configurações antes de criar o acesso.');
        }
        tx.update(ref, { name, role: PRODUCTION_ROLE, active: true, ...firstAccess(pin, versionOf(data) + 1, now), updatedAt: new Date(now).toISOString() });
        recordAccessAudit(tx, { operation: 'badge.adopt', actorUserId, targetUserId: ref.id });
        return true;
      }
      tx.create(ref, { name, badge, role: PRODUCTION_ROLE, active: true, ...firstAccess(pin, 0, now), createdAt: new Date(now).toISOString() });
      recordAccessAudit(tx, { operation: 'badge.create', actorUserId, targetUserId: ref.id });
      return false;
    });
    return { userId: ref.id, pin, adopted };
  },
  async reset(userId, actorUserId) {
    const ref = adminDb.collection('users').doc(userId);
    const pin = generateBadgePin();
    await adminDb.runTransaction(async tx => {
      const current = await tx.get(ref);
      const data = current.data();
      if (!current.exists || typeof data?.badge !== 'string' || !data.badge) throw new AccessError('Este funcionário não entra pelo crachá.');
      tx.update(ref, { ...firstAccess(pin, versionOf(data) + 1, Date.now()), active: true, updatedAt: new Date().toISOString() });
      recordAccessAudit(tx, { operation: 'badge.reset', actorUserId, targetUserId: userId });
    });
    return { pin };
  },
  async deactivate(userId, actorUserId) {
    const ref = adminDb.collection('users').doc(userId);
    return adminDb.runTransaction(async tx => {
      const current = await tx.get(ref);
      const data = current.data();
      if (!current.exists || typeof data?.badge !== 'string' || !data.badge || data.active === false) return false;
      tx.update(ref, { active: false, authVersion: versionOf(data) + 1, updatedAt: new Date().toISOString() });
      recordAccessAudit(tx, { operation: 'badge.deactivate', actorUserId, targetUserId: userId });
      return true;
    });
  },
};
