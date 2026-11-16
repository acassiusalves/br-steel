import { beforeEach, describe, expect, it } from 'vitest';
import { POST as login } from '@/app/api/auth/login/route';
import { PATCH as profile } from '@/app/api/auth/profile/route';
import { createSessionToken, hashPassword } from '@/lib/server-auth';
import { firestoreBadgeAccounts, generateBadgePin, normalizeBadge } from '@/server/access/badges';
import { LOGIN_FAILURES_PER_WINDOW } from '@/server/access/login-rate-limit';
import { adminDb, resetDatabase, seedUser } from '../helpers/firestore';

let ipCounter = 0;
/** Cada teste sai de um IP próprio, para o limite por IP não vazar entre testes. */
let ip = '';
const request = (path: string, method: string, body: unknown, token?: string, from = ip) => new Request(`http://localhost/api/auth/${path}`, {
  method, headers: { origin: 'http://localhost', 'content-type': 'application/json', 'x-forwarded-for': from,
    ...(token ? { cookie: `brsteel_session=${token}` } : {}) },
  body: JSON.stringify(body),
});
const tokenOf = (response: Response) => response.headers.get('set-cookie')!.split(';')[0].slice('brsteel_session='.length);
const doc = () => adminDb.collection('users').doc('cracha-26557');

describe('acesso pelo crachá', () => {
  let pin = '';
  beforeEach(async () => {
    await resetDatabase();
    ip = `203.0.113.${++ipCounter}`;
    ({ pin } = await firestoreBadgeAccounts.create('Líder de teste', '26557'));
  });

  it('o primeiro acesso usa o PIN sorteado (nunca 123456), nasce como Produção e exige uma senha pessoal diferente do PIN', async () => {
    expect(pin).toMatch(/^\d{6}$/);
    expect(pin).not.toBe('123456');
    expect((await login(request('login', 'POST', { badge: '26557', password: '123456' }))).status).toBe(401);
    const first = await login(request('login', 'POST', { badge: ' 26557 ', password: pin }));
    expect(first.status).toBe(200);
    const body = await first.json();
    expect(body.user).toMatchObject({ badge: '26557', role: 'Produção', mustChangePassword: true });
    const token = tokenOf(first);
    expect((await profile(request('profile', 'PATCH', { name: 'Líder de teste', newPassword: pin }, token))).status).toBe(400);
    expect((await profile(request('profile', 'PATCH', { name: 'Líder de teste', newPassword: '123456' }, token))).status).toBe(400);
    expect((await profile(request('profile', 'PATCH', { name: 'Líder de teste', newPassword: '12345' }, token))).status).toBe(400);
    const personal = pin === '842913' ? '842914' : '842913';
    const changed = await profile(request('profile', 'PATCH', { name: 'Líder de teste', newPassword: personal }, token));
    expect(changed.status).toBe(200);
    expect((await changed.json()).user.mustChangePassword).toBe(false);
    expect((await doc().get()).data()!.initialPasswordExpiresAt).toBeUndefined();
    expect((await login(request('login', 'POST', { badge: '26557', password: pin }))).status).toBe(401);
    expect((await login(request('login', 'POST', { badge: '26557', password: personal }))).status).toBe(200);
  });

  it('o PIN vence em 72 horas', async () => {
    await doc().update({ initialPasswordExpiresAt: Date.now() - 1 });
    const expired = await login(request('login', 'POST', { badge: '26557', password: pin }));
    expect(expired.status).toBe(403);
    expect((await expired.json()).error).toContain('venceu');
    expect((await doc().get()).data()!.initialPasswordExpiresAt).toBeLessThan(Date.now());
  });

  it('conta antiga sem senha gravada não entra mais com 123456', async () => {
    await seedUser('cracha-77777', { name: 'Antiga', badge: '77777', role: 'Operador', mustChangePassword: true });
    expect((await login(request('login', 'POST', { badge: '77777', password: '123456' }))).status).toBe(401);
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

  it('o reset gera um PIN novo, desbloqueia e encerra as sessões abertas', async () => {
    const { hash, salt } = hashPassword('842913');
    await doc().update({ passwordHash: hash, passwordSalt: salt, mustChangePassword: false, lockedUntil: Date.now() + 60_000 });
    const before = (await doc().get()).data()!;
    const { pin: fresh } = await firestoreBadgeAccounts.reset('cracha-26557');
    const after = (await doc().get()).data()!;
    expect(after).toMatchObject({ mustChangePassword: true, lockedUntil: 0, authVersion: before.authVersion + 1 });
    expect(after.initialPasswordExpiresAt).toBeGreaterThan(Date.now() + 71 * 3_600_000);
    expect((await login(request('login', 'POST', { badge: '26557', password: '842913' }))).status).toBe(401);
    const relogin = await login(request('login', 'POST', { badge: '26557', password: fresh }));
    expect(relogin.status).toBe(200);
    expect((await relogin.json()).user.mustChangePassword).toBe(true);
  });

  it('criar de novo o acesso de um crachá que já tem conta zera a conta: senha, papel, desativação e sessões', async () => {
    const { hash, salt } = hashPassword('senha-de-teste');
    await doc().update({ passwordHash: hash, passwordSalt: salt, mustChangePassword: false, role: 'Administrador', active: false });
    const before = (await doc().get()).data()!;
    const again = await firestoreBadgeAccounts.create('Outro nome', '26557');
    expect(again).toMatchObject({ userId: 'cracha-26557', adopted: true });
    const after = (await doc().get()).data()!;
    expect(after).toMatchObject({ name: 'Outro nome', role: 'Produção', active: true, mustChangePassword: true, authVersion: before.authVersion + 1 });
    expect((await login(request('login', 'POST', { badge: '26557', password: 'senha-de-teste' }))).status).toBe(401);
    expect((await login(request('login', 'POST', { badge: '26557', password: again.pin }))).status).toBe(200);
  });

  it('não reseta conta de e-mail e normaliza o código', async () => {
    await seedUser('email-user', { name: 'E-mail', email: 'pessoa@example.test', role: 'Operador' });
    await expect(firestoreBadgeAccounts.reset('email-user')).rejects.toThrow();
    expect(normalizeBadge('ab-12')).toBe('AB-12');
    expect(normalizeBadge(' 012 ')).toBe('012');
    expect(normalizeBadge('12 34')).toBeNull();
    const pins = new Set(Array.from({ length: 200 }, generateBadgePin));
    expect([...pins].every(p => /^\d{6}$/.test(p) && p !== '123456')).toBe(true);
    expect(pins.size).toBeGreaterThan(190);
  });

  it('quem entra com e-mail continua precisando de 12 caracteres', async () => {
    const { hash, salt } = hashPassword('senha-original-longa');
    const user = { id: 'pessoa', name: 'Pessoa', email: 'pessoa@example.test', role: 'Vendedor' };
    await seedUser(user.id, { ...user, passwordHash: hash, passwordSalt: salt });
    const token = createSessionToken(user);
    expect((await profile(request('profile', 'PATCH', { name: 'Pessoa', currentPassword: 'senha-original-longa', newPassword: 'curta1' }, token))).status).toBe(400);
  });

  it(`depois de ${LOGIN_FAILURES_PER_WINDOW} senhas erradas, o IP espera, sem dizer se o crachá existe; outro IP segue entrando`, async () => {
    for (let i = 0; i < LOGIN_FAILURES_PER_WINDOW; i++) {
      const body = i % 2 ? { badge: `9${i}`, password: '000000' } : { email: `ninguem${i}@example.test`, password: 'x' };
      expect((await login(request('login', 'POST', body))).status).toBe(401);
    }
    const limited = await login(request('login', 'POST', { badge: '26557', password: pin }));
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toMatch(/^\d+$/);
    expect((await limited.json()).error).not.toMatch(/crachá|senha/i);
    expect((await login(request('login', 'POST', { badge: '26557', password: pin }, undefined, '198.51.100.7'))).status).toBe(200);
    const stored = await adminDb.collection('loginRateLimits').get();
    expect(stored.docs.every(d => !JSON.stringify(d.data()).includes(ip) && !d.id.includes(ip))).toBe(true);
  });
});

describe('acesso pelo crachá sob tentativas simultâneas', () => {
  let pin = '';
  beforeEach(async () => { await resetDatabase(); ip = `203.0.113.${++ipCounter}`; ({ pin } = await firestoreBadgeAccounts.create('Líder de teste', '26557')); });
  it('10 senhas erradas ao mesmo tempo bloqueiam o crachá', async () => {
    const statuses = await Promise.all(Array.from({ length: 10 }, () => login(request('login', 'POST', { badge: '26557', password: 'errada' })).then(r => r.status)));
    expect(statuses.every(status => status === 401 || status === 429)).toBe(true);
    expect((await login(request('login', 'POST', { badge: '26557', password: pin }))).status).toBe(429);
  });
});

describe('IP do limite de login', () => {
  it('usa o valor da plataforma e, sem ele, o último salto: a primeira entrada do cliente não conta', async () => {
    const { clientIp } = await import('@/server/access/login-rate-limit');
    const req = (headers: Record<string, string>) => new Request('http://localhost/api/auth/login', { headers });
    expect(clientIp(req({ 'x-vercel-forwarded-for': '198.51.100.9', 'x-forwarded-for': '1.2.3.4, 198.51.100.9' }), true)).toBe('198.51.100.9');
    expect(clientIp(req({ 'x-real-ip': '198.51.100.10', 'x-forwarded-for': '1.2.3.4' }), true)).toBe('198.51.100.10');
    // Fora da Vercel, os cabeçalhos da plataforma podem vir do cliente: vale o último salto.
    expect(clientIp(req({ 'x-vercel-forwarded-for': '1.2.3.4', 'x-real-ip': '1.2.3.5', 'x-forwarded-for': '1.2.3.6, 198.51.100.12' }), false)).toBe('198.51.100.12');
    expect(clientIp(req({ 'x-forwarded-for': '1.2.3.4, 198.51.100.11' }), false)).toBe('198.51.100.11');
    expect(clientIp(req({}), false)).toBe('desconhecido');
  });
});
