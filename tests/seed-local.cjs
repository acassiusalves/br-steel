// Synthetic accounts only. Refuse any project or host outside this test environment.
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { randomBytes, scryptSync } = require('node:crypto');

if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8188'
  || process.env.GCLOUD_PROJECT !== 'demo-brsteel-auth') {
  throw new Error('Set the local demo-brsteel-auth emulator before creating fixtures.');
}
initializeApp({ projectId: 'demo-brsteel-auth' });
const db = getFirestore();
async function seed() {
  for (const [id, role] of [['admin', 'Administrador'], ['seller', 'Vendedor'], ['operator', 'Operador']]) {
    const salt = randomBytes(16).toString('base64url');
    await db.collection('users').doc(`fixture-${id}`).set({
      name: `Teste ${role}`, email: `${id}@example.test`, normalizedEmail: `${id}@example.test`, role,
      active: true, authVersion: 0, mustChangePassword: id === 'operator',
      passwordSalt: salt, passwordHash: scryptSync('Local-test-only-2026', salt, 64).toString('base64url'),
      createdAt: new Date().toISOString(),
    });
  }
  console.log('Three synthetic accounts created in demo-brsteel-auth.');
  await db.terminate();
}
seed().catch(error => { console.error(error.message); process.exitCode = 1; });
