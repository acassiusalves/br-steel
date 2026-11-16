'use server';

import crypto from 'node:crypto';
import { z } from 'zod';
import { adminDb } from '@/lib/firebase-admin';
import { requireActionPage, requireAdministrator } from '@/server/access/current-user';
import { recordAccessAudit } from '@/server/access/audit';
import { AccessError } from '@/server/access/errors';
import { adminAction, type AdminActionResult } from '@/server/access/admin-action';
import { hashPassword } from '@/server/access/passwords';
import { normalizeUserEmail, publicUser, storedUserFromDoc, validDocumentId } from '@/server/access/users';
import type { User } from '@/types/user';


const roleSchema = z.enum(['Administrador', 'Vendedor', 'Operador', 'Produção']);
const newUserSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().email().max(254),
  role: roleSchema,
}).strict();

export async function getUsers(): Promise<User[]> {
  await requireAdministrator();
  const snapshot = await adminDb.collection('users').get();
  return snapshot.docs.map(d => publicUser(storedUserFromDoc(d.id, d.data())))
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}
/**
 * Minimal directory for the legacy Kanban, separate from user administration. It never returns the badge code:
 * the badge is a login identifier and this list reaches every operator.
 */
export async function getAssignableUsers(): Promise<Array<Pick<User, 'id' | 'name' | 'role'>>> {
  await requireActionPage('/producao/kanban');
  const snapshot = await adminDb.collection('users').get();
  return snapshot.docs.map(d => storedUserFromDoc(d.id, d.data()))
    .filter(u => u.active !== false && ['Administrador', 'Operador', 'Produção'].includes(u.role))
    .map(({ id, name, role }) => ({ id, name, role }))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}
/** Accounts the administrator can link to a PCP worker, including inactive ones so a stale link stays visible. */
export async function getLinkableAccounts(): Promise<Array<Pick<User, 'id' | 'name' | 'role' | 'badge'> & { active: boolean }>> {
  await requireAdministrator();
  const snapshot = await adminDb.collection('users').get();
  return snapshot.docs.map(d => storedUserFromDoc(d.id, d.data()))
    .filter(u => ['Administrador', 'Operador', 'Produção'].includes(u.role))
    .map(({ id, name, role, badge, active }) => ({ id, name, role, active: active !== false, ...(badge ? { badge } : {}) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}
const temporaryCredential = () => {
  const temporaryPassword = crypto.randomBytes(18).toString('base64url');
  return { temporaryPassword, ...hashPassword(temporaryPassword) };
};

export async function addUser(input: Pick<User, 'name' | 'email' | 'role'>): Promise<AdminActionResult<{ id: string; temporaryPassword: string }>> {
  return adminAction(async () => {
    const admin = await requireAdministrator();
    const user = newUserSchema.parse(input);
    const { temporaryPassword, hash, salt } = temporaryCredential();
    const users = adminDb.collection('users');
    const ref = users.doc();
    await adminDb.runTransaction(async tx => {
      // Include legacy mixed-case records in the uniqueness check.
      const existing = await tx.get(users);
      if (existing.docs.some(d => normalizeUserEmail(String(d.data().email || d.data().normalizedEmail || d.id)) === user.email)) {
        throw new AccessError('Já existe um usuário com este e-mail.');
      }
      tx.create(ref, {
        ...user, normalizedEmail: user.email, passwordHash: hash, passwordSalt: salt,
        createdAt: new Date().toISOString(), mustChangePassword: true, active: true, authVersion: 0,
      });
      recordAccessAudit(tx, { operation: 'user.create', actorUserId: admin.id, targetUserId: ref.id });
    });
    return { id: ref.id, temporaryPassword };
  });
}
/**
 * Nova senha temporária para conta de e-mail (inclusive contas antigas sem senha gravada, que não entram mais
 * com 123456). Encerra as sessões abertas e obriga a cadastrar a senha pessoal. Conta de crachá usa o reset
 * da Engenharia, que gera um PIN.
 */
export async function resetUserPassword(userId: string): Promise<AdminActionResult<{ temporaryPassword: string }>> {
  return adminAction(async () => {
    const admin = await requireAdministrator();
    if (!validDocumentId(userId)) throw new AccessError('Usuário inválido.');
    if (userId === admin.id) throw new AccessError('Troque a sua própria senha em Perfil.');
    const ref = adminDb.collection('users').doc(userId);
    const { temporaryPassword, hash, salt } = temporaryCredential();
    await adminDb.runTransaction(async tx => {
      const snapshot = await tx.get(ref);
      if (!snapshot.exists) throw new AccessError('Usuário não encontrado.');
      const current = storedUserFromDoc(snapshot.id, snapshot.data()!);
      if (current.badge) throw new AccessError('Esta conta entra pelo crachá. Use "Resetar senha" na Engenharia, que gera um PIN.');
      tx.update(ref, {
        passwordHash: hash, passwordSalt: salt, mustChangePassword: true, authVersion: current.authVersion + 1,
        updatedAt: new Date().toISOString(),
      });
      recordAccessAudit(tx, { operation: 'password.change', actorUserId: admin.id, targetUserId: userId });
    });
    return { temporaryPassword };
  });
}
async function changeUser(id: string, change: { role?: string; active?: boolean; remove?: boolean }) {
  const admin = await requireAdministrator();
  if (!validDocumentId(id)) throw new AccessError('Usuário inválido.');
  if (id === admin.id) throw new AccessError('Você não pode alterar, desativar ou remover o próprio acesso. Peça a outro administrador.');
  const users = adminDb.collection('users');
  await adminDb.runTransaction(async tx => {
    const snapshot = await tx.get(users);
    const target = snapshot.docs.find(d => d.id === id);
    if (!target) throw new AccessError('Usuário não encontrado.');
    const current = storedUserFromDoc(target.id, target.data());
    if (current.badge && change.remove) {
      throw new AccessError('Conta de crachá não é removida, porque o histórico do Kanban guarda quem agiu. Desative o acesso.');
    }
    if (current.badge && change.role === 'Administrador') {
      throw new AccessError('Administradores entram com e-mail. Uma conta de crachá não pode ser Administrador.');
    }
    const removesAdmin = change.remove || change.active === false || (change.role !== undefined && change.role !== 'Administrador');
    if (current.role === 'Administrador' && current.active !== false && removesAdmin) {
      const hasOtherAdmin = snapshot.docs.some(d => d.id !== id && d.data().role === 'Administrador' && d.data().active !== false);
      if (!hasOtherAdmin) throw new AccessError('Mantenha ao menos um administrador ativo.');
    }
    const audit = (operation: Parameters<typeof recordAccessAudit>[1]['operation']) =>
      recordAccessAudit(tx, { operation, actorUserId: admin.id, targetUserId: id });
    if (change.remove) { tx.delete(target.ref); audit('user.delete'); return; }
    const update: { updatedAt: string; role?: string; active?: boolean; authVersion?: number } = { updatedAt: new Date().toISOString() };
    if (change.role !== undefined && change.role !== current.role) { update.role = change.role; audit('user.role'); }
    if (change.active !== undefined && change.active !== (current.active !== false)) {
      update.active = change.active;
      update.authVersion = current.authVersion + 1;
      audit(change.active ? 'user.activate' : 'user.deactivate');
    }
    tx.update(target.ref, update);
  });
  return null;
}
export async function deleteUser(userId: string): Promise<AdminActionResult> {
  return adminAction(() => changeUser(userId, { remove: true }));
}
export async function updateUserRole(userId: string, role: string): Promise<AdminActionResult> {
  return adminAction(() => changeUser(userId, { role: roleSchema.parse(role) }));
}
export async function setUserActive(userId: string, active: boolean): Promise<AdminActionResult> {
  return adminAction(() => changeUser(userId, { active: z.boolean().parse(active) }));
}
