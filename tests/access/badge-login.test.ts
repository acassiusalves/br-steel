import { beforeEach, describe, expect, it } from 'vitest';
import { POST as login } from '@/app/api/auth/login/route';
import { PATCH as profile } from '@/app/api/auth/profile/route';
import { createSessionToken, hashPassword } from '@/lib/server-auth';
import { BADGE_ROLE, firestoreBadgeAccounts, generateInitialPin, isTrivialPin, normalizeBadge } from '@/server/access/badges';
import { adminDb, resetDatabase, seedUser } from '../helpers/firestore';

const request = (path: string, method: string, body: unknown, token?: string, address?: string) => new Request(`http://localhost/api/auth/${path}`, {
  method,
  headers: {
    origin: 'http://localhost', 'content-type': 'application/json',
    ...(token ? { cookie: `brsteel_session=${token}` } : {}), ...(address ? { 'x-forwarded-for': address } : {}),
  },
  body: JSON.stringify(body),
});
const tokenOf = (response: Response) => response.headers.get('set-cookie')!.split(';')[0].slice('brsteel_session='.length);
const account = async () => (await adminDb.collection('users').doc('cracha-26557').get()).data()!;

describe('acesso pelo crachá', () => {
  let pin: string;
  beforeEach(async () => { await resetDatabase(); pin = (await firestoreBadgeAccounts.create('Líder de teste', '26557')).initialPassword; });

  it('nasce com PIN individual de 6 dígitos, papel Produção e só o hash gravado; 123456 não entra', async () => {
    expect(pin).toMatch(/^\d{6}$/);
    const stored = await account();
    expect(stored).toMatchObject({ role: BADGE_ROLE, active: true, mustChangePassword: true });
    expect(stored.passwordHash).toEqual(expect.any(String));
    expect(JSON.stringify(stored)).not.toContain(pin);
    expect(stored.initialPasswordExpiresAt).toBeGreaterThan(Date.now() + 71 * 3_600_000);
    expect((await login(request('login', 'POST', { badge: '26557', password: '123456' }))).status).toBe(401);
  });

  it('primeiro acesso com o PIN exige senha pessoal de 6 caracteres, nem óbvia nem igual ao PIN', async () => {
    const first = await login(request('login', 'POST', { badge: ' 26557 ', password: pin }));
    expect(first.status).toBe(200);
    expect((await first.json()).user).toMatchObject({ badge: '26557', role: BADGE_ROLE, mustChangePassword: true });
    const token = tokenOf(first);
    for (const weak of ['123456', '12345', '111111', '654321', pin]) {
      expect((await profile(request('profile', 'PATCH', { name: 'Líder de teste', newPassword: weak }, token))).status).toBe(400);
    }
    const changed = await profile(request('profile', 'PATCH', { name: 'Líder de teste', newPassword: '842913' }, token));
    expect(changed.status).toBe(200);
    expect((await changed.json()).user.mustChangePassword).toBe(false);
    expect((await account()).initialPasswordExpiresAt).toBeUndefined();
    expect((await login(request('login', 'POST', { badge: '26557', password: pin }))).status).toBe(401);
    expect((await login(request('login', 'POST', { badge: '26557', password: '842913' }))).status).toBe(200);
  });

  it('o PIN vencido não entra, mesmo certo, e a mensagem manda pedir reset', async () => {
    await adminDb.collection('users').doc('cracha-26557').update({ initialPasswordExpiresAt: Date.now() - 1 });
    const expired = await login(request('login', 'POST', { badge: '26557', password: pin }));
    expect(expired.status).toBe(401);
    expect((await expired.json()).error).toContain('venceu');
  });

  it('conta antiga sem senha gravada não entra mais com 123456', async () => {
    await adminDb.collection('users').doc('cracha-26557').update({ passwordHash: null, passwordSalt: null, initialPasswordExpiresAt: null });
    expect((await login(request('login', 'POST', { badge: '26557', password: '123456' }))).status).toBe(401);
  });

  it('bloqueia o crachá por 15 minutos depois de 5 senhas erradas, mesmo com a senha certa', async () => {
    for (let i = 0; i < 5; i++) expect((await login(request('login', 'POST', { badge: '26557', password: 'errada' }))).status).toBe(401);
    const blocked = await login(request('login', 'POST', { badge: '26557', password: pin }));
    expect(blocked.status).toBe(429);
    expect((await blocked.json()).error).toContain('bloqueado');
  });

  it('conta de crachá não entra pelo campo de e-mail, onde não há bloqueio', async () => {
    expect((await login(request('login', 'POST', { email: 'cracha-26557', password: pin }))).status).toBe(401);
  });

  it('o reset gera outro PIN, desbloqueia e encerra as sessões abertas', async () => {
    const { hash, salt } = hashPassword('842913');
    await adminDb.collection('users').doc('cracha-26557').update({ passwordHash: hash, passwordSalt: salt, mustChangePassword: false, lockedUntil: Date.now() + 60_000 });
    const before = await account();
    const reset = await firestoreBadgeAccounts.reset('cracha-26557');
    const after = await account();
    expect(after).toMatchObject({ mustChangePassword: true, lockedUntil: 0, authVersion: before.authVersion + 1 });
    expect(after.passwordHash).not.toBe(hash);
    expect((await login(request('login', 'POST', { badge: '26557', password: '842913' }))).status).toBe(401);
    const relogin = await login(request('login', 'POST', { badge: '26557', password: reset.initialPassword }));
    expect(relogin.status).toBe(200);
    expect((await relogin.json()).user.mustChangePassword).toBe(true);
  });

  it('criar de novo adota a conta do mesmo crachá com reset: senha antiga para de valer, conta volta ativa e Produção', async () => {
    const { hash, salt } = hashPassword('842913');
    await adminDb.collection('users').doc('cracha-26557').update({
      passwordHash: hash, passwordSalt: salt, mustChangePassword: false, active: false, role: 'Operador',
    });
    const before = await account();
    const adopted = await firestoreBadgeAccounts.create('Outro nome', '26557');
    expect(adopted.userId).toBe('cracha-26557');
    expect(await account()).toMatchObject({ name: 'Outro nome', role: BADGE_ROLE, active: true, mustChangePassword: true, authVersion: before.authVersion + 1 });
    expect((await login(request('login', 'POST', { badge: '26557', password: '842913' }))).status).toBe(401);
    expect((await login(request('login', 'POST', { badge: '26557', password: adopted.initialPassword }))).status).toBe(200);
  });

  it('não adota conta de administrador nem reseta conta de e-mail', async () => {
    await adminDb.collection('users').doc('cracha-26557').update({ role: 'Administrador' });
    await expect(firestoreBadgeAccounts.create('Outro nome', '26557')).rejects.toThrow(/administrador/);
    await seedUser('email-user', { name: 'E-mail', email: 'pessoa@example.test', role: 'Operador' });
    await expect(firestoreBadgeAccounts.reset('email-user')).rejects.toThrow();
  });

  it('normaliza o crachá e reconhece PINs óbvios', () => {
    expect(normalizeBadge('ab-12')).toBe('AB-12');
    expect(normalizeBadge('12 34')).toBeNull();
    for (const weak of ['000000', '123456', '654321', '890123', 'aaaaaa']) expect(isTrivialPin(weak)).toBe(true);
    for (const ok of ['842913', '135790', 'senha1']) expect(isTrivialPin(ok)).toBe(false);
    for (let i = 0; i < 50; i++) expect(isTrivialPin(generateInitialPin())).toBe(false);
  });

  it('quem entra com e-mail continua precisando de 12 caracteres', async () => {
    const { hash, salt } = hashPassword('senha-original-longa');
    const user = { id: 'pessoa', name: 'Pessoa', email: 'pessoa@example.test', role: 'Vendedor' };
    await seedUser(user.id, { ...user, passwordHash: hash, passwordSalt: salt });
    const token = createSessionToken(user);
    expect((await profile(request('profile', 'PATCH', { name: 'Pessoa', currentPassword: 'senha-original-longa', newPassword: 'curta1' }, token))).status).toBe(400);
  });
});

describe('acesso pelo crachá sob tentativas simultâneas', () => {
  let pin: string;
  beforeEach(async () => { await resetDatabase(); pin = (await firestoreBadgeAccounts.create('Líder de teste', '26557')).initialPassword; });
  it('10 senhas erradas ao mesmo tempo bloqueiam o crachá', async () => {
    const statuses = await Promise.all(Array.from({ length: 10 }, () => login(request('login', 'POST', { badge: '26557', password: 'errada' })).then(r => r.status)));
    expect(statuses.every(status => status === 401 || status === 429)).toBe(true);
    expect((await login(request('login', 'POST', { badge: '26557', password: pin }))).status).toBe(429);
  });
});

describe('limite de login por endereço', () => {
  beforeEach(async () => { await resetDatabase(); });
  it('depois de 20 tentativas no minuto, o endereço recebe 429 com Retry-After, sem afetar outro endereço', async () => {
    // Uma tentativa por crachá diferente: o bloqueio por crachá nunca dispara, só o limite por endereço.
    for (let i = 0; i < 20; i++) {
      expect((await login(request('login', 'POST', { badge: `9${i}`, password: '123456' }, undefined, '203.0.113.7'))).status).toBe(401);
    }
    const limited = await login(request('login', 'POST', { badge: '999', password: '123456' }, undefined, '203.0.113.7'));
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
    expect((await limited.json()).error).toContain('Muitas tentativas');
    expect((await login(request('login', 'POST', { badge: '999', password: '123456' }, undefined, '198.51.100.4'))).status).toBe(401);
    const counters = await adminDb.collection('loginRateLimits').get();
    expect(counters.docs.every(doc => !JSON.stringify(doc.data()).includes('203.0.113.7') && !doc.id.includes('203'))).toBe(true);
  });
});
