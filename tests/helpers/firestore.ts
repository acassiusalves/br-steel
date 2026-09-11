import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';

if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8188'
  || process.env.GCLOUD_PROJECT !== 'demo-brsteel-auth') throw new Error('Local test emulator required');
const app = getApps().find(a => a.name === 'auth-tests')
  ?? initializeApp({ projectId: 'demo-brsteel-auth' }, 'auth-tests');
export const adminDb = getFirestore(app);
export const cookieJar = { value: '' };
export const seedUser = (id: string, data: Record<string, unknown> = {}) => adminDb.collection('users').doc(id).set({
  name: id, email: `${id}@example.test`, normalizedEmail: `${id}@example.test`,
  role: 'Vendedor', createdAt: '2026-09-01T12:00:00Z', ...data,
});
export async function resetDatabase() {
  cookieJar.value = '';
  const response = await fetch('http://127.0.0.1:8188/emulator/v1/projects/demo-brsteel-auth/databases/(default)/documents', { method: 'DELETE' });
  if (!response.ok) throw new Error('Could not reset test emulator');
}
export const loadRules = () => initializeTestEnvironment({
  projectId: 'demo-brsteel-auth',
  firestore: { host: '127.0.0.1', port: 8188, rules: readFileSync('firestore.rules', 'utf8') },
});
