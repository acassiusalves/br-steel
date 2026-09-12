import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { adminDb } from '@/lib/firebase-admin';
import type { SessionUser } from '@/lib/server-auth';
import { getOAuthProvider } from './supabase';
import { OAuthError } from './errors';
export const identityBindingId = (userId: string) => createHash('sha256').update(userId).digest('hex');
export async function boundIdentity(userId: string) {
  const binding = await adminDb.collection('mcpIdentityBindings').doc(identityBindingId(userId)).get();
  if (!binding.exists || binding.data()?.status !== 'ready') return null;
  const data = binding.data()!;
  const reverse = await adminDb.collection('mcpIdentities').doc(data.sub).get();
  if (data.userId !== userId || reverse.data()?.userId !== userId || reverse.data()?.disabledAt) {
    throw new OAuthError('IDENTITY_COLLISION', 'A identidade do conector não corresponde ao cadastro.', 409);
  }
  return { sub: data.sub as string, email: data.email as string };
}
export async function ensureOAuthIdentity(user: SessionUser) {
  const ref = adminDb.collection('mcpIdentityBindings').doc(identityBindingId(user.id));
  const sub = await adminDb.runTransaction(async tx => {
    const snapshot = await tx.get(ref);
    if (snapshot.exists) {
      if (snapshot.data()?.userId !== user.id) throw new OAuthError('IDENTITY_COLLISION', 'Vínculo de identidade inválido.', 409);
      return snapshot.data()!.sub as string;
    }
    const reserved = randomUUID();
    tx.create(ref, { userId: user.id, sub: reserved, status: 'provisioning', createdAt: Date.now() });
    return reserved;
  });
  const external = await getOAuthProvider().ensureIdentity(sub, user);
  if (external.sub !== sub) throw new OAuthError('IDENTITY_COLLISION', 'O provedor retornou outra identidade.', 409);
  await adminDb.runTransaction(async tx => {
    const reverseRef = adminDb.collection('mcpIdentities').doc(sub);
    const [binding, reverse] = await Promise.all([tx.get(ref), tx.get(reverseRef)]);
    if (binding.data()?.sub !== sub || binding.data()?.userId !== user.id
      || (reverse.exists && (reverse.data()?.userId !== user.id || reverse.data()?.disabledAt))) {
      throw new OAuthError('IDENTITY_COLLISION', 'Identidade já vinculada a outro cadastro.', 409);
    }
    if (!reverse.exists) tx.create(reverseRef, { userId: user.id, createdAt: Date.now() });
    tx.update(ref, { status: 'ready', email: external.email });
  });
  return external;
}
