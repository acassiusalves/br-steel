import { afterAll, beforeAll, expect, it } from 'vitest';
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { loadRules } from '../helpers/firestore';
let env: RulesTestEnvironment;
beforeAll(async () => {
  env = await loadRules();
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, 'users/user-a'), { passwordHash: 'private', role: 'Administrador' });
    await setDoc(doc(db, 'appSettings/general'), { permissions: {} });
  });
});
afterAll(async () => { await env?.cleanup(); });
it.each(['anonymous', 'firebase-admin-claim'])('protects users and permissions from the %s client', async mode => {
  const db = mode === 'anonymous' ? env.unauthenticatedContext().firestore() : env.authenticatedContext('user-a', { role: 'Administrador' }).firestore();
  for (const collection of ['mcpIdentities', 'mcpIdentityBindings', 'mcpConnections', 'mcpAuthorizationIntents']) {
    await assertFails(getDoc(doc(db, `${collection}/any`)));
    await assertFails(setDoc(doc(db, `${collection}/injected`), { status: 'active', userId: 'user-a' }));
  }
  await assertFails(getDoc(doc(db, 'users/user-a')));
  await assertFails(setDoc(doc(db, 'users/injected'), { role: 'Administrador' }));
  await assertFails(getDoc(doc(db, 'appSettings/general')));
  await assertFails(setDoc(doc(db, 'appSettings/general'), { permissions: {} }));
  await assertFails(setDoc(doc(db, 'users/user-a/private/secret'), { secret: 'x' }));
});
it('allows server-side access with emulator rules disabled', async () => {
  await env.withSecurityRulesDisabled(async context => {
    const snap = await assertSucceeds(getDoc(doc(context.firestore(), 'users/user-a')));
    expect(snap.data()?.role).toBe('Administrador');
  });
});
