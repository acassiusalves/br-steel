import 'server-only';
import { adminDb } from '@/lib/firebase-admin';

export type AccessAuditOperation =
  | 'user.create' | 'user.role' | 'user.activate' | 'user.deactivate' | 'user.delete'
  | 'badge.create' | 'badge.adopt' | 'badge.reset' | 'badge.deactivate' | 'badge.locked'
  | 'badge.move' | 'badge.moveUndo' | 'user.rename'
  | 'password.change';

export type AccessAuditEntry = {
  operation: AccessAuditOperation;
  /** Quem fez: o usuário da sessão, ou null quando foi o próprio sistema (bloqueio por tentativas). */
  actorUserId: string | null;
  targetUserId: string;
};

/**
 * Registro das mudanças de identidade, gravado na mesma transação da mudança. Guarda só ids, a operação e o
 * instante: nada de nome, e-mail, senha ou endereço de rede. A coleção é fechada ao cliente pelas regras.
 */
export function recordAccessAudit(tx: FirebaseFirestore.Transaction, entry: AccessAuditEntry, now = new Date()) {
  tx.create(adminDb.collection('accessAudit').doc(), { ...entry, at: now.toISOString() });
}
