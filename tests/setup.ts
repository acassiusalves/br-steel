import { vi } from 'vitest';

// Tests may reach only this local emulator; never load real application credentials.
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8188';
process.env.GCLOUD_PROJECT = 'demo-brsteel-auth';
process.env.APP_ORIGIN = 'http://localhost';
process.env.AUTH_SESSION_SECRET = 'test-only-session-key-at-least-32-characters';
vi.mock('server-only', () => ({}));
vi.mock('@/lib/firebase-admin', async () => {
  const { adminDb } = await import('./helpers/firestore');
  return { adminDb };
});
vi.mock('@/lib/firebase', async () => {
  const { initializeApp, getApps } = await import('firebase/app');
  const { getFirestore, connectFirestoreEmulator } = await import('firebase/firestore');
  const app = getApps().find(a => a.name === 'auth-tests')
    ?? initializeApp({ projectId: 'demo-brsteel-auth', apiKey: 'test-only' }, 'auth-tests');
  const db = getFirestore(app);
  connectFirestoreEmulator(db, '127.0.0.1', 8188);
  return { db, app };
});
vi.mock('next/headers', async () => {
  const { cookieJar } = await import('./helpers/firestore');
  return {
    cookies: async () => ({ get: (name: string) => cookieJar.value ? { name, value: cookieJar.value } : undefined }),
  };
});
const realFetch = globalThis.fetch;
vi.stubGlobal('fetch', (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : input.toString());
  if (!['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error('External network forbidden in tests');
  return realFetch(input, init);
});
