import 'server-only';
import crypto from 'node:crypto';
import { adminDb } from '@/lib/firebase-admin';
import { DEFAULT_INITIAL_PASSWORD, hashPassword } from './passwords';
import type { StoredUser } from './users';

/**
 * Acesso pelo crachá, como no iApp: o funcionário entra com o código do crachá e uma senha, sem e-mail.
 * Na criação e em cada reset feito pelo administrador, a conta recebe um PIN inicial aleatório de 6 dígitos,
 * mostrado uma vez ao administrador e válido por 72 h. No primeiro acesso, o sistema obriga a cadastrar uma
 * senha pessoal antes de liberar as telas.
 */
export const BADGE_MIN_PASSWORD = 6;
export const BADGE_MAX_FAILURES = 5;
export const BADGE_LOCK_MS = 15 * 60_000;
export const BADGE_INITIAL_PASSWORD_TTL_MS = 72 * 60 * 60_000;
/** Papel das contas de crachá: só o quadro de OPs, o perfil e os próprios reportes. */
export const BADGE_ROLE = 'Produção';
/** A senha padrão antiga nunca é aceita como senha pessoal. */
export const BADGE_INITIAL_PASSWORD = DEFAULT_INITIAL_PASSWORD;
export const BADGE_INITIAL_PASSWORD_EXPIRED = 'A senha de primeiro acesso venceu. Peça ao administrador para resetar a senha.';

/** Códigos do crachá: letras, números e hífen, sem diferença entre maiúsculas e minúsculas. */
export function normalizeBadge(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const badge = raw.trim().toUpperCase();
  return /^[A-Z0-9-]{1,40}$/.test(badge) ? badge : null;
}
/** O id do documento deriva do crachá: dois funcionários não podem ter o mesmo código. */
export const badgeUserId = (badge: string) => `cracha-${badge.toLowerCase()}`;
export const isBadgeUser = (user: Pick<StoredUser, 'badge'>) => typeof user.badge === 'string' && user.badge.length > 0;

/** Senhas fáceis de adivinhar: um caractere repetido ou dígitos em sequência (123456, 654321). */
export function isTrivialPin(value: string): boolean {
  if (/^(.)\1+$/.test(value)) return true;
  if (!/^\d{3,}$/.test(value)) return false;
  const steps = new Set([...value].slice(1).map((digit, i) => (Number(digit) - Number(value[i]) + 10) % 10));
  return steps.size === 1 && (steps.has(1) || steps.has(9));
}
export function generateInitialPin(): string {
  for (;;) {
    const pin = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    if (!isTrivialPin(pin)) return pin;
  }
}

/** Devolvido uma única vez ao administrador; só o hash fica gravado. */
export type BadgeCredential = { userId: string; initialPassword: string; expiresAt: number };

export type BadgeAccounts = {
  /**
   * Cria a conta do crachá com um PIN inicial. Se já existe conta para o mesmo crachá, ela é adotada e
   * volta ao primeiro acesso: PIN novo, troca obrigatória, sessões encerradas, conta ativa e papel de produção.
   * Recusa conta de administrador e conta cujo documento pertence a outro código.
   */
  create(name: string, badge: string): Promise<BadgeCredential>;
  /** Volta a conta para o primeiro acesso com um PIN novo; as sessões abertas são encerradas. */
  reset(userId: string): Promise<BadgeCredential>;
};

function initialCredential(now: number) {
  const initialPassword = generateInitialPin();
  const { hash, salt } = hashPassword(initialPassword);
  const expiresAt = now + BADGE_INITIAL_PASSWORD_TTL_MS;
  return {
    initialPassword, expiresAt,
    fields: {
      passwordHash: hash, passwordSalt: salt, mustChangePassword: true, initialPasswordExpiresAt: expiresAt,
      failedLogins: 0, lockedUntil: 0, updatedAt: new Date(now).toISOString(),
    },
  };
}
const nextAuthVersion = (data: FirebaseFirestore.DocumentData) => (Number.isSafeInteger(data.authVersion) && data.authVersion >= 0 ? data.authVersion : 0) + 1;

export const firestoreBadgeAccounts: BadgeAccounts = {
  async create(name, badge) {
    const ref = adminDb.collection('users').doc(badgeUserId(badge));
    const credential = initialCredential(Date.now());
    await adminDb.runTransaction(async tx => {
      const current = await tx.get(ref);
      if (current.exists) {
        const data = current.data()!;
        if (data.badge !== badge) throw new Error('Já existe outra conta com este código de crachá.');
        if (data.role === 'Administrador') {
          throw new Error('Este crachá já tem um login de administrador. Ajuste o papel em Configurações antes de criar o acesso.');
        }
        tx.update(ref, { ...credential.fields, name, role: BADGE_ROLE, active: true, authVersion: nextAuthVersion(data) });
        return;
      }
      tx.create(ref, {
        ...credential.fields, name, badge, role: BADGE_ROLE, active: true, authVersion: 0, createdAt: new Date().toISOString(),
      });
    });
    return { userId: ref.id, initialPassword: credential.initialPassword, expiresAt: credential.expiresAt };
  },
  async reset(userId) {
    const ref = adminDb.collection('users').doc(userId);
    const credential = initialCredential(Date.now());
    await adminDb.runTransaction(async tx => {
      const current = await tx.get(ref);
      const data = current.data();
      if (!current.exists || typeof data?.badge !== 'string' || !data.badge) throw new Error('Este funcionário não entra pelo crachá.');
      tx.update(ref, { ...credential.fields, authVersion: nextAuthVersion(data) });
    });
    return { userId, initialPassword: credential.initialPassword, expiresAt: credential.expiresAt };
  },
};
