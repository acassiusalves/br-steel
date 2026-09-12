import { afterAll, beforeAll, expect, it } from 'vitest';
import { assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { loadRules, adminDb } from '../helpers/firestore';
let env: Awaited<ReturnType<typeof loadRules>>;
beforeAll(async () => { env = await loadRules(); });
afterAll(async () => { await env.cleanup(); });
it('blocks anonymous and Firebase-authenticated direct business reads/writes while Admin SDK still works', async () => {
  const paths = ['salesOrders/protected', 'supplies/protected', 'inventoryMovements/protected', 'productionColumns/protected', 'productionLots/protected', 'productionLotItems/protected', 'productionComments/protected', 'stockUpdates/protected', 'supplyCodes/protected', 'operationsMetadata/protected', 'webhookDebugLogs/protected', 'appConfig/blingCredentials', 'appConfig/syncProgress', 'appConfig/stockWebhookStatus', 'appConfig/webhookStatus'];
  for (const path of paths) {
    await adminDb.doc(path).set({ protectedFixture: true });
    expect((await adminDb.doc(path).get()).exists).toBe(true);
    for (const db of [env.unauthenticatedContext().firestore(), env.authenticatedContext('forged-admin', { role: 'Administrador' }).firestore()]) {
      await assertFails(getDoc(doc(db, path))); await assertFails(setDoc(doc(db, path), { attack: true }));
    }
  }
});
