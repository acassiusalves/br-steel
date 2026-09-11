import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import crypto from 'node:crypto';
import { createSessionToken, getSessionFromRequest, hashPassword, requirePagePermission, verifySessionToken } from '@/lib/server-auth';
import { adminDb, resetDatabase, seedUser } from '../helpers/firestore';

const user = { id: 'member', name: 'Member', email: 'member@example.test', role: 'Administrador' };
const request = (token = createSessionToken(user)) => new Request('http://localhost/api/auth/me', { headers: { cookie: `brsteel_session=${token}` } });
beforeEach(async () => {
  await resetDatabase();
  const { hash, salt } = hashPassword('member-password-unique');
  await seedUser(user.id, { ...user, passwordHash: hash, passwordSalt: salt });
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

describe('session boundary', () => {
  it('requires a dedicated configured production secret', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('AUTH_SESSION_SECRET', '');
    vi.stubEnv('NEXTAUTH_SECRET', '');
    vi.stubEnv('BR_STEEL_WEBHOOK_SECRET', 'webhook-must-not-authorize-users');
    expect(() => createSessionToken(user)).toThrow();
  });
  it('rejects tampered, extra-segment and expired tokens', () => {
    const token = createSessionToken(user);
    expect(verifySessionToken(`${token}tampered`)).toBeNull();
    expect(verifySessionToken(`${token}.extra`)).toBeNull();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 8 * 60 * 60 * 1000);
    expect(verifySessionToken(token)).toBeNull();
  });
  it('rejects a signed payload without a stable user ID', () => {
    const body = Buffer.from(JSON.stringify({ user: { ...user, id: undefined }, exp: Date.now() + 60000 })).toString('base64url');
    const signature = crypto.createHmac('sha256', process.env.AUTH_SESSION_SECRET!).update(body).digest('base64url');
    expect(verifySessionToken(`${body}.${signature}`)).toBeNull();
  });
  it('handles malformed cookie encoding as unauthenticated', async () => {
    expect(await getSessionFromRequest(new Request('http://localhost', { headers: { cookie: 'brsteel_session=%ZZ' } }))).toBeNull();
  });
  it('uses the current role rather than the signed role', async () => {
    const req = request();
    await adminDb.collection('users').doc(user.id).update({ role: 'Vendedor' });
    const result = await requirePagePermission(req, '/financeiro/conciliacao');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(403);
  });
  it.each(['deleted', 'inactive'])('rejects a %s user on the next request', async (state) => {
    const req = request();
    const ref = adminDb.collection('users').doc(user.id);
    if (state === 'deleted') await ref.delete(); else await ref.update({ active: false });
    expect(await getSessionFromRequest(req)).toBeNull();
  });
  it('does not resurrect a deleted identity by matching another user email', async () => {
    const req = request();
    await adminDb.collection('users').doc(user.id).delete();
    await seedUser('different-id', { email: user.email, role: 'Administrador' });
    expect(await getSessionFromRequest(req)).toBeNull();
  });
  it('invalidates sessions after the user auth version changes', async () => {
    const req = request();
    await adminDb.collection('users').doc(user.id).update({ authVersion: 1 });
    expect(await getSessionFromRequest(req)).toBeNull();
  });
  it('keeps a legacy user with no active field signed in by ID', async () => {
    expect((await getSessionFromRequest(request()))?.user.id).toBe('member');
  });
  it('denies disabled pages even to administrators', async () => {
    await adminDb.collection('appSettings').doc('general').set({ inactivePages: ['/vendas'] });
    const result = await requirePagePermission(request(), '/vendas');
    expect(result.ok).toBe(false);
  });
  it('requires the initial password to be replaced before module access', async () => {
    await adminDb.collection('users').doc(user.id).update({ mustChangePassword: true });
    expect((await requirePagePermission(request(), '/vendas')).ok).toBe(false);
    expect((await requirePagePermission(request(), '/perfil')).ok).toBe(true);
  });
});
