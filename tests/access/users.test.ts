import { beforeEach, expect, it } from 'vitest';
import {
  addUser, deleteUser, getUsers, updateUserRole, getAssignableUsers, getLinkableAccounts, resetUserPassword, setUserActive,
} from '@/services/user-service';
import type { AdminActionResult } from '@/server/access/admin-action';
import { loadAppSettings, saveAppSettings } from '@/services/app-settings-service';
import { createSessionToken, hashPassword, verifyPassword, getSessionFromToken } from '@/lib/server-auth';
import { adminDb, cookieJar, resetDatabase, seedUser } from '../helpers/firestore';

beforeEach(async () => {
  await resetDatabase();
  const { hash, salt } = hashPassword('unique-admin-password');
  await seedUser('admin', { role: 'Administrador', passwordHash: hash, passwordSalt: salt, unexpectedSecret: 'must-stay-private' });
});
/** As ações de administração devolvem o erro como dado (em produção, a mensagem de um erro lançado some). */
const failed = async (result: Promise<AdminActionResult<unknown>>) => {
  const outcome = await result;
  expect(outcome.ok).toBe(false);
  return outcome.ok ? '' : outcome.error;
};
const unwrap = async <T,>(result: Promise<AdminActionResult<T>>): Promise<T> => {
  const outcome = await result;
  if (!outcome.ok) throw new Error(outcome.error);
  return outcome.data;
};
const auditOf = async (targetUserId: string) => (await adminDb.collection('accessAudit').where('targetUserId', '==', targetUserId).get())
  .docs.map(doc => doc.data()).sort((a, b) => String(a.at).localeCompare(String(b.at)));
function signIn(role = 'Administrador') {
  cookieJar.value = createSessionToken({ id: 'admin', name: 'admin', email: 'admin@example.test', role });
}
it('does not expose hashes, salts or arbitrary stored fields in user listing', async () => {
  signIn();
  const users = await getUsers();
  expect(users).toHaveLength(1);
  expect(users[0]).not.toHaveProperty('passwordHash');
  expect(users[0]).not.toHaveProperty('passwordSalt');
  expect(users[0]).not.toHaveProperty('unexpectedSecret');
});
it('rejects anonymous calls to user administration and settings', async () => {
  await expect(getUsers()).rejects.toThrow();
  expect(await failed(addUser({ name: 'Injected', email: 'injected@example.test', role: 'Administrador' }))).toContain('Sessão expirada');
  await failed(updateUserRole('admin', 'Vendedor'));
  await failed(deleteUser('admin'));
  await expect(loadAppSettings()).rejects.toThrow();
  await failed(saveAppSettings({ permissions: {} }));
});
it.each(['Vendedor', 'Operador'])('rejects %s administration even with an old admin cookie', async (role) => {
  signIn();
  await adminDb.collection('users').doc('admin').update({ role });
  await failed(updateUserRole('admin', 'Administrador'));
  await failed(saveAppSettings({ permissions: {} }));
  expect((await adminDb.collection('users').doc('admin').get()).data()?.role).toBe(role);
});
it('creates individual temporary passwords and persists only their hashes', async () => {
  signIn();
  const a = await unwrap(addUser({ name: 'Ana', email: 'ANA@example.test', role: 'Vendedor' }));
  const b = await unwrap(addUser({ name: 'Bia', email: 'bia@example.test', role: 'Operador' }));
  expect(a.temporaryPassword).toEqual(expect.any(String));
  expect(a.temporaryPassword.length).toBeGreaterThanOrEqual(16);
  expect(a.temporaryPassword).not.toBe(b.temporaryPassword);
  const saved = (await adminDb.collection('users').doc(a.id).get()).data()!;
  expect(saved).not.toHaveProperty('temporaryPassword');
  expect(saved.mustChangePassword).toBe(true);
  expect(saved.email).toBe('ana@example.test');
  expect(verifyPassword(a.temporaryPassword, saved.passwordHash, saved.passwordSalt)).toBe(true);
  expect(verifyPassword('123456', saved.passwordHash, saved.passwordSalt)).toBe(false);
  expect(await auditOf(a.id)).toEqual([expect.objectContaining({ operation: 'user.create', actorUserId: 'admin', targetUserId: a.id })]);
  expect(JSON.stringify(await auditOf(a.id))).not.toContain('ana@example.test');
});
it('rejects unknown roles and duplicate emails', async () => {
  signIn();
  expect(await failed(addUser({ name: 'Eve', email: 'eve@example.test', role: 'Superuser' }))).toContain('Dados inválidos');
  expect(await failed(addUser({ name: 'Other', email: 'ADMIN@example.test', role: 'Vendedor' }))).toBe('Já existe um usuário com este e-mail.');
});
it('does not let an administrator remove, demote or deactivate their own access', async () => {
  signIn();
  expect(await failed(deleteUser('admin'))).toContain('próprio acesso');
  await failed(updateUserRole('admin', 'Operador'));
  await failed(setUserActive('admin', false));
  expect((await adminDb.collection('users').doc('admin').get()).data()).toMatchObject({ role: 'Administrador' });
});
it('rejects arbitrary settings and preserves non-permission fields', async () => {
  signIn();
  await adminDb.collection('appSettings').doc('general').set({ gordura_variable: 12 });
  await failed(saveAppSettings({ inactivePages: ['/configuracoes'] }));
  await unwrap(saveAppSettings({ permissions: { '/vendas': ['Administrador'] }, inactivePages: ['/estoque'] }));
  expect((await adminDb.collection('appSettings').doc('general').get()).data()?.gordura_variable).toBe(12);
});

it('revokes sessions permanently when disabling then reactivating an account', async () => {
  signIn();
  const { hash, salt } = hashPassword('operator-unique-password');
  await seedUser('operator', { role: 'Operador', passwordHash: hash, passwordSalt: salt });
  const token = createSessionToken({ id: 'operator', name: 'operator', email: 'operator@example.test', role: 'Operador' });
  expect(await getSessionFromToken(token)).not.toBeNull();
  await unwrap(setUserActive('operator', false));
  expect(await getSessionFromToken(token)).toBeNull();
  await unwrap(setUserActive('operator', true));
  expect(await getSessionFromToken(token)).toBeNull();
  expect((await adminDb.collection('users').doc('operator').get()).data()?.authVersion).toBe(2);
  expect((await auditOf('operator')).map(entry => entry.operation)).toEqual(['user.deactivate', 'user.activate']);
  await failed(setUserActive('admin', false));
});
it('provides the operator a minimal active directory without user-administration access', async () => {
  const { hash, salt } = hashPassword('operator-unique-password');
  await seedUser('operator', { role: 'Operador', passwordHash: hash, passwordSalt: salt });
  await seedUser('inactive', { role: 'Operador', active: false });
  await expect(getAssignableUsers()).rejects.toThrow();
  cookieJar.value = createSessionToken({ id: 'operator', name: 'operator', email: 'operator@example.test', role: 'Operador' });
  const directory = await getAssignableUsers();
  expect(directory.map(user => user.id).sort()).toEqual(['admin', 'operator']);
  expect(directory.every(user => Object.keys(user).sort().join(',') === 'id,name,role')).toBe(true);
  await expect(getUsers()).rejects.toThrow();
});
it('lists linkable accounts with badge and status only to the administrator', async () => {
  await seedUser('cracha-26557', { role: 'Produção', badge: '26557', active: false });
  const { hash, salt } = hashPassword('lider-unique-password');
  await seedUser('cracha-30001', { role: 'Produção', badge: '30001', passwordHash: hash, passwordSalt: salt });
  await seedUser('seller', { role: 'Vendedor' });
  cookieJar.value = createSessionToken({ id: 'cracha-30001', name: 'Líder', email: 'cracha-30001', role: 'Produção' });
  await expect(getLinkableAccounts()).rejects.toThrow(/Sem permissão/);
  signIn();
  const accounts = await getLinkableAccounts();
  expect(accounts.map(a => a.id).sort()).toEqual(['admin', 'cracha-26557', 'cracha-30001']);
  expect(accounts.find(a => a.id === 'cracha-26557')).toEqual({ id: 'cracha-26557', name: 'cracha-26557', role: 'Produção', badge: '26557', active: false });
  // O diretório do Kanban antigo chega a qualquer operador e nunca leva o crachá, que é o nome de login.
  const directory = await getAssignableUsers();
  expect(directory.some(user => 'badge' in user)).toBe(false);
});
it('demotes another administrator and records who did it', async () => {
  signIn();
  await seedUser('second-admin', { role: 'Administrador' });
  await unwrap(updateUserRole('second-admin', 'Vendedor'));
  const all = await adminDb.collection('users').get();
  expect(all.docs.filter(doc => doc.data().role === 'Administrador' && doc.data().active !== false).map(doc => doc.id)).toEqual(['admin']);
  expect(await auditOf('second-admin')).toEqual([expect.objectContaining({ operation: 'user.role', actorUserId: 'admin' })]);
});
it('keeps badge accounts out of the Administrador role and never deletes them', async () => {
  signIn();
  await seedUser('cracha-26557', { role: 'Produção', badge: '26557' });
  expect(await failed(updateUserRole('cracha-26557', 'Administrador'))).toContain('e-mail');
  expect(await failed(deleteUser('cracha-26557'))).toContain('Desative');
  expect((await adminDb.collection('users').doc('cracha-26557').get()).data()).toMatchObject({ role: 'Produção' });
  await unwrap(setUserActive('cracha-26557', false));
  expect((await adminDb.collection('users').doc('cracha-26557').get()).data()?.active).toBe(false);
});
it('gives an e-mail account without a stored password a new temporary password; 123456 never logs in', async () => {
  signIn();
  await seedUser('legacy', { role: 'Operador', authVersion: 3 });
  expect(verifyPassword('123456', undefined, undefined)).toBe(false);
  const { temporaryPassword } = await unwrap(resetUserPassword('legacy'));
  const saved = (await adminDb.collection('users').doc('legacy').get()).data()!;
  expect(verifyPassword(temporaryPassword, saved.passwordHash, saved.passwordSalt)).toBe(true);
  expect(saved).toMatchObject({ mustChangePassword: true, authVersion: 4 });
  expect(await auditOf('legacy')).toEqual([expect.objectContaining({ operation: 'password.change', actorUserId: 'admin' })]);
  await seedUser('cracha-26557', { role: 'Produção', badge: '26557' });
  expect(await failed(resetUserPassword('cracha-26557'))).toContain('Engenharia');
  expect(await failed(resetUserPassword('admin'))).toContain('Perfil');
});
