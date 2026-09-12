import { beforeEach, expect, it } from 'vitest';
import { addUser, deleteUser, getUsers, updateUserRole, getAssignableUsers, setUserActive } from '@/services/user-service';
import { loadAppSettings, saveAppSettings } from '@/services/app-settings-service';
import { createSessionToken, hashPassword, verifyPassword, getSessionFromToken } from '@/lib/server-auth';
import { adminDb, cookieJar, resetDatabase, seedUser } from '../helpers/firestore';

beforeEach(async () => {
  await resetDatabase();
  const { hash, salt } = hashPassword('unique-admin-password');
  await seedUser('admin', { role: 'Administrador', passwordHash: hash, passwordSalt: salt, unexpectedSecret: 'must-stay-private' });
});
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
  await expect(addUser({ name: 'Injected', email: 'injected@example.test', role: 'Administrador' })).rejects.toThrow();
  await expect(updateUserRole('admin', 'Vendedor')).rejects.toThrow();
  await expect(deleteUser('admin')).rejects.toThrow();
  await expect(loadAppSettings()).rejects.toThrow();
  await expect(saveAppSettings({ permissions: {} })).rejects.toThrow();
});
it.each(['Vendedor', 'Operador'])('rejects %s administration even with an old admin cookie', async (role) => {
  signIn();
  await adminDb.collection('users').doc('admin').update({ role });
  await expect(updateUserRole('admin', 'Administrador')).rejects.toThrow();
  await expect(saveAppSettings({ permissions: {} })).rejects.toThrow();
  expect((await adminDb.collection('users').doc('admin').get()).data()?.role).toBe(role);
});
it('creates individual temporary passwords and persists only their hashes', async () => {
  signIn();
  const a = await addUser({ name: 'Ana', email: 'ANA@example.test', role: 'Vendedor' }) as { id: string; temporaryPassword: string };
  const b = await addUser({ name: 'Bia', email: 'bia@example.test', role: 'Operador' }) as { id: string; temporaryPassword: string };
  expect(a.temporaryPassword).toEqual(expect.any(String));
  expect(a.temporaryPassword.length).toBeGreaterThanOrEqual(16);
  expect(a.temporaryPassword).not.toBe(b.temporaryPassword);
  const saved = (await adminDb.collection('users').doc(a.id).get()).data()!;
  expect(saved).not.toHaveProperty('temporaryPassword');
  expect(saved.mustChangePassword).toBe(true);
  expect(saved.email).toBe('ana@example.test');
  expect(verifyPassword(a.temporaryPassword, saved.passwordHash, saved.passwordSalt)).toBe(true);
  expect(verifyPassword('123456', saved.passwordHash, saved.passwordSalt)).toBe(false);
});
it('rejects unknown roles and duplicate emails', async () => {
  signIn();
  await expect(addUser({ name: 'Eve', email: 'eve@example.test', role: 'Superuser' })).rejects.toThrow();
  await expect(addUser({ name: 'Other', email: 'ADMIN@example.test', role: 'Vendedor' })).rejects.toThrow();
});
it('does not remove or demote the last active administrator', async () => {
  signIn();
  await expect(deleteUser('admin')).rejects.toThrow();
  await expect(updateUserRole('admin', 'Operador')).rejects.toThrow();
});
it('rejects arbitrary settings and preserves non-permission fields', async () => {
  signIn();
  await adminDb.collection('appSettings').doc('general').set({ gordura_variable: 12 });
  await expect(saveAppSettings({ inactivePages: ['/configuracoes'] })).rejects.toThrow();
  await saveAppSettings({ permissions: { '/vendas': ['Administrador'] }, inactivePages: ['/estoque'] });
  expect((await adminDb.collection('appSettings').doc('general').get()).data()?.gordura_variable).toBe(12);
});

it('revokes sessions permanently when disabling then reactivating an account', async () => {
  signIn();
  const { hash, salt } = hashPassword('operator-unique-password');
  await seedUser('operator', { role: 'Operador', passwordHash: hash, passwordSalt: salt });
  const token = createSessionToken({ id: 'operator', name: 'operator', email: 'operator@example.test', role: 'Operador' });
  expect(await getSessionFromToken(token)).not.toBeNull();
  await setUserActive('operator', false);
  expect(await getSessionFromToken(token)).toBeNull();
  await setUserActive('operator', true);
  expect(await getSessionFromToken(token)).toBeNull();
  expect((await adminDb.collection('users').doc('operator').get()).data()?.authVersion).toBe(2);
  await expect(setUserActive('admin', false)).rejects.toThrow();
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
it('keeps an active administrator under concurrent demotions', async () => {
  signIn();
  await seedUser('second-admin', { role: 'Administrador' });
  const outcomes = await Promise.allSettled([updateUserRole('admin', 'Operador'), updateUserRole('second-admin', 'Vendedor')]);
  expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  const all = await adminDb.collection('users').get();
  expect(all.docs.filter(doc => doc.data().role === 'Administrador' && doc.data().active !== false)).toHaveLength(1);
});
