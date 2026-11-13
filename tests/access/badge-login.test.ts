import { beforeEach, describe, expect, it } from 'vitest';
import { POST as login } from '@/app/api/auth/login/route';
import { PATCH as profile } from '@/app/api/auth/profile/route';
import { createSessionToken, hashPassword } from '@/lib/server-auth';
import { firestoreBadgeAccounts, normalizeBadge } from '@/server/access/badges';
import { adminDb, resetDatabase, seedUser } from '../helpers/firestore';

const request = (path: string, method: string, body: unknown, token?: string) => new Request(`http://localhost/api/auth/${path}`, {
  method, headers: { origin: 'http://localhost', 'content-type': 'application/json', ...(token ? { cookie: `brsteel_session=${token}` } : {}) },
  body: JSON.stringify(body),
});
const tokenOf = (response: Response) => response.headers.get('set-cookie')!.split(';')[0].slice('brsteel_session='.length);

describe('acesso pelo crachá', () => {
  beforeEach(async () => { await resetDatabase(); await firestoreBadgeAccounts.create('Líder de teste', '26557'); });

  it('primeiro acesso com 123456 exige cadastrar a senha pessoal, de 6 caracteres e diferente de 123456', async () => {
    const first = await login(request('login', 'POST', { badge: ' 26557 ', password: '123456' }));
    expect(first.status).toBe(200);
    const body = await first.json();
    expect(body.user).toMatchObject({ badge: '26557', role: 'Operador', mustChangePassword: true });
    const token = tokenOf(first);
    expect((await profile(request('profile', 'PATCH', { name: 'Líder de teste', newPassword: '123456' }, token))).status).toBe(400);
    expect((await profile(request('profile', 'PATCH', { name: 'Líder de teste', newPassword: '12345' }, token))).status).toBe(400);
    const changed = await profile(request('profile', 'PATCH', { name: 'Líder de teste', newPassword: '842913' }, token));
    expect(changed.status).toBe(200);
    expect((await changed.json()).user.mustChangePassword).toBe(false);
    expect((await login(request('login', 'POST', { badge: '26557', password: '123456' }))).status).toBe(401);
    expect((await login(request('login', 'POST', { badge: '26557', password: '842913' }))).status).toBe(200);
  });

  it('bloqueia o crachá por 15 minutos depois de 5 senhas erradas, mesmo com a senha certa', async () => {
    for (let i = 0; i < 5; i++) expect((await login(request('login', 'POST', { badge: '26557', password: 'errada' }))).status).toBe(401);
    const blocked = await login(request('login', 'POST', { badge: '26557', password: '123456' }));
    expect(blocked.status).toBe(429);
    expect((await blocked.json()).error).toContain('bloqueado');
  });

  it('conta de crachá não entra pelo campo de e-mail, onde não há bloqueio', async () => {
    expect((await login(request('login', 'POST', { email: 'cracha-26557', password: '123456' }))).status).toBe(401);
  });

  it('o reset do administrador volta para 123456, desbloqueia e encerra as sessões abertas', async () => {
    const { hash, salt } = hashPassword('842913');
    await adminDb.collection('users').doc('cracha-26557').update({ passwordHash: hash, passwordSalt: salt, mustChangePassword: false, lockedUntil: Date.now() + 60_000 });
    const before = (await adminDb.collection('users').doc('cracha-26557').get()).data()!;
    await firestoreBadgeAccounts.reset('cracha-26557');
    const after = (await adminDb.collection('users').doc('cracha-26557').get()).data()!;
    expect(after).toMatchObject({ mustChangePassword: true, lockedUntil: 0, authVersion: before.authVersion + 1 });
    expect(after.passwordHash).toBeUndefined();
    const relogin = await login(request('login', 'POST', { badge: '26557', password: '123456' }));
    expect(relogin.status).toBe(200);
    expect((await relogin.json()).user.mustChangePassword).toBe(true);
  });

  it('não reseta conta de e-mail e não cria duas contas para o mesmo crachá', async () => {
    await seedUser('email-user', { name: 'E-mail', email: 'pessoa@example.test', role: 'Operador' });
    await expect(firestoreBadgeAccounts.reset('email-user')).rejects.toThrow();
    expect((await firestoreBadgeAccounts.create('Outro nome', '26557')).userId).toBe('cracha-26557');
    expect(normalizeBadge('ab-12')).toBe('AB-12');
    expect(normalizeBadge('12 34')).toBeNull();
  });

  it('quem entra com e-mail continua precisando de 12 caracteres', async () => {
    const { hash, salt } = hashPassword('senha-original-longa');
    const user = { id: 'pessoa', name: 'Pessoa', email: 'pessoa@example.test', role: 'Vendedor' };
    await seedUser(user.id, { ...user, passwordHash: hash, passwordSalt: salt });
    const token = createSessionToken(user);
    expect((await profile(request('profile', 'PATCH', { name: 'Pessoa', currentPassword: 'senha-original-longa', newPassword: 'curta1' }, token))).status).toBe(400);
  });
});
