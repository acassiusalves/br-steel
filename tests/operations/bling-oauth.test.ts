import { beforeEach, expect, it, vi } from 'vitest';
import { seedOperations } from './fixtures';
import { adminDb } from '../helpers/firestore';
import { createSessionToken } from '@/lib/server-auth';
const jar = vi.hoisted(() => ({ values: new Map<string, string>(), set: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: (name: string) => jar.values.has(name) ? { value: jar.values.get(name) } : undefined, set: (name: string, value: string, options: unknown) => { jar.set(name, value, options); jar.values.set(name, value); } }) }));
import { beginBlingConnection, consumeBlingConnection } from '@/server/integrations/bling-oauth';
beforeEach(async () => {
  await seedOperations(); jar.values.clear(); jar.set.mockClear();
  jar.values.set('brsteel_session', createSessionToken({ id: 'ops-admin', name: 'Admin de teste', email: 'ops-admin@example.test', role: 'Administrador' }));
  await adminDb.collection('appConfig').doc('blingCredentials').set({ clientId: 'synthetic-client' });
});
it('issues an opaque, HttpOnly, administrator-bound state and consumes it once', async () => {
  const url = new URL(await beginBlingConnection()); const state = url.searchParams.get('state');
  expect(state).toMatch(/^[\w-]{43}$/);
  expect(jar.set).toHaveBeenCalledWith('brsteel_bling_state', `ops-admin:${state}`, expect.objectContaining({ httpOnly: true, sameSite: 'lax', maxAge: 600, path: '/api/callback/bling' }));
  await expect(consumeBlingConnection('attacker-state')).rejects.toThrow();
  await consumeBlingConnection(state);
  await expect(consumeBlingConnection(state)).rejects.toThrow();
});
it('rejects a missing state and a role changed after issuing the state', async () => {
  await expect(consumeBlingConnection(null)).rejects.toThrow();
  const state = new URL(await beginBlingConnection()).searchParams.get('state');
  await adminDb.collection('users').doc('ops-admin').update({ role: 'Vendedor' });
  await expect(consumeBlingConnection(state)).rejects.toThrow();
  await expect(beginBlingConnection()).rejects.toThrow();
});
