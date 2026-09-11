'use server';

import crypto from 'node:crypto';
import { z } from 'zod';
import { adminDb } from '@/lib/firebase-admin';
import { requireActionPage, requireAdministrator } from '@/server/access/current-user';
import { hashPassword } from '@/server/access/passwords';
import { normalizeUserEmail, publicUser, storedUserFromDoc, validDocumentId } from '@/server/access/users';
import type { User } from '@/types/user';

const roleSchema = z.enum(['Administrador', 'Vendedor', 'Operador']);
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
/** Minimal directory for the Kanban, separate from user administration. */
export async function getAssignableUsers(): Promise<Array<Pick<User, 'id' | 'name' | 'role'>>> {
  await requireActionPage('/producao/kanban');
  const snapshot = await adminDb.collection('users').get();
  return snapshot.docs.map(d => storedUserFromDoc(d.id, d.data()))
    .filter(u => u.active !== false && ['Administrador', 'Operador'].includes(u.role))
    .map(({ id, name, role }) => ({ id, name, role }))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}
export async function addUser(input: Pick<User, 'name' | 'email' | 'role'>): Promise<{ id: string; temporaryPassword: string }> {
  await requireAdministrator();
  const user = newUserSchema.parse(input);
  const temporaryPassword = crypto.randomBytes(18).toString('base64url');
  const { hash, salt } = hashPassword(temporaryPassword);
  const users = adminDb.collection('users');
  const ref = users.doc();
  await adminDb.runTransaction(async tx => {
    // Include legacy mixed-case records in the uniqueness check.
    const existing = await tx.get(users);
    if (existing.docs.some(d => normalizeUserEmail(String(d.data().email || d.data().normalizedEmail || d.id)) === user.email)) {
      throw new Error('Já existe um usuário com este e-mail.');
    }
    tx.create(ref, {
      ...user, normalizedEmail: user.email, passwordHash: hash, passwordSalt: salt,
      createdAt: new Date().toISOString(), mustChangePassword: true, active: true, authVersion: 0,
    });
  });
  return { id: ref.id, temporaryPassword };
}
async function changeUser(id: string, change: { role?: string; active?: boolean; remove?: boolean }) {
  await requireAdministrator();
  if (!validDocumentId(id)) throw new Error('Usuário inválido.');
  const users = adminDb.collection('users');
  await adminDb.runTransaction(async tx => {
    const snapshot = await tx.get(users);
    const target = snapshot.docs.find(d => d.id === id);
    if (!target) throw new Error('Usuário não encontrado.');
    const current = storedUserFromDoc(target.id, target.data());
    const removesAdmin = change.remove || change.active === false || (change.role !== undefined && change.role !== 'Administrador');
    if (current.role === 'Administrador' && current.active !== false && removesAdmin) {
      const hasOtherAdmin = snapshot.docs.some(d => d.id !== id && d.data().role === 'Administrador' && d.data().active !== false);
      if (!hasOtherAdmin) throw new Error('Mantenha ao menos um administrador ativo.');
    }
    if (change.remove) { tx.delete(target.ref); return; }
    const update: { updatedAt: string; role?: string; active?: boolean; authVersion?: number } = { updatedAt: new Date().toISOString() };
    if (change.role !== undefined) update.role = change.role;
    if (change.active !== undefined) {
      update.active = change.active;
      if (change.active !== (current.active !== false)) update.authVersion = current.authVersion + 1;
    }
    tx.update(target.ref, update);
  });
}
export async function deleteUser(userId: string): Promise<void> { await changeUser(userId, { remove: true }); }
export async function updateUserRole(userId: string, role: string): Promise<void> {
  await changeUser(userId, { role: roleSchema.parse(role) });
}
export async function setUserActive(userId: string, active: boolean): Promise<void> {
  await changeUser(userId, { active: z.boolean().parse(active) });
}
