import 'server-only';
import crypto from 'node:crypto';

// A senha padrão antiga não abre mais nenhuma conta: fica só para ser recusada como senha nova.
export const DEFAULT_INITIAL_PASSWORD = '123456';
export function hashPassword(password: string, salt = crypto.randomBytes(16).toString('base64url')) {
  return { hash: crypto.scryptSync(password, salt, 64).toString('base64url'), salt };
}
export function verifyPassword(password: string, hash?: string | null, salt?: string | null) {
  // Conta sem senha gravada não entra com nada: o administrador gera uma senha temporária ou um PIN novo.
  if (!hash || !salt || password.length > 1024) return false;
  try {
    const stored = Buffer.from(hash, 'base64url');
    const candidate = crypto.scryptSync(password, salt, 64);
    return stored.length === candidate.length && crypto.timingSafeEqual(candidate, stored);
  } catch { return false; }
}
export function needsPasswordChange(user: { mustChangePassword?: boolean; passwordHash?: string | null; passwordSalt?: string | null }) {
  return !!user.mustChangePassword || !user.passwordHash || !user.passwordSalt
    || verifyPassword(DEFAULT_INITIAL_PASSWORD, user.passwordHash, user.passwordSalt);
}
