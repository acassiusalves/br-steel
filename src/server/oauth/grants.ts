import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { adminDb } from '@/lib/firebase-admin';
import type { Capability } from '@/server/access/types';
import type { SessionPayload } from '@/lib/server-auth';
import { OAuthError, RevocationNotSentError } from './errors';
import { boundIdentity } from './identity-bridge';
import type { OAuthAuthorizationDetails, ProviderSession } from './types';
import { getOAuthProvider } from './supabase';

export interface AuthorizationIntent {
  authorization: OAuthAuthorizationDetails; userId: string; sub: string; authVersion: number;
  expiresAt: number; status: 'prepared' | 'processing' | 'approved' | 'denied' | 'failed';
}
export interface Connection {
  userId: string; sub: string; clientId: string; clientName: string; capabilities: Capability[];
  status: 'pending' | 'active' | 'revocation_pending' | 'revoked';
  authVersion: number; validAfter: number; approvedAt: number | null; revokedAt: number | null;
  /** Stamped by the read audit on every call, so it is the only evidence a connection is in use. */
  lastSeenAt?: number | null;
  approvalId: string;
  revocationAttempt?: string | null;
}
export const connectionId = (sub: string, clientId: string) => createHash('sha256').update(JSON.stringify([sub, clientId])).digest('hex');
export const intentRef = (id: string) => adminDb.collection('mcpAuthorizationIntents').doc(id);
export const connectionRef = (id: string) => adminDb.collection('mcpConnections').doc(id);
export async function storeIntent(local: SessionPayload, sub: string, authorization: OAuthAuthorizationDetails) {
  const ref = intentRef(authorization.authorization_id);
  await adminDb.runTransaction(async tx => {
    const snapshot = await tx.get(ref);
    if (snapshot.exists) {
      const existing = snapshot.data() as AuthorizationIntent;
      if (existing.userId !== local.user.id || existing.sub !== sub || existing.authVersion !== local.authVersion
        || existing.status !== 'prepared' || existing.expiresAt <= Date.now()) {
        throw new OAuthError('AUTHORIZATION_USED', 'Esta solicitação já foi usada. Inicie uma nova conexão.', 409);
      }
      return;
    }
    tx.create(ref, { userId: local.user.id, sub, authVersion: local.authVersion,
      authorization, status: 'prepared', expiresAt: Date.now() + 5 * 60 * 1000 } satisfies AuthorizationIntent);
  });
}
export async function readIntent(id: string, local: SessionPayload, sub: string) {
  const snapshot = await intentRef(id).get();
  const intent = snapshot.data() as AuthorizationIntent | undefined;
  if (!intent || intent.userId !== local.user.id || intent.sub !== sub || intent.authVersion !== local.authVersion) {
    throw new OAuthError('AUTHORIZATION_INVALID', 'Solicitação não encontrada para este usuário.', 404);
  }
  if (intent.status !== 'prepared' || intent.expiresAt <= Date.now()) {
    throw new OAuthError('AUTHORIZATION_USED', 'Esta solicitação expirou ou já foi usada. Inicie uma nova conexão.', 409);
  }
  return intent;
}
export async function beginDecision(id: string, local: SessionPayload, sub: string, capabilities: Capability[] | null) {
  const approvalId = randomUUID();
  return adminDb.runTransaction(async tx => {
    const requestRef = intentRef(id);
    const snapshot = await tx.get(requestRef);
    const intent = snapshot.data() as AuthorizationIntent | undefined;
    if (!intent || intent.userId !== local.user.id || intent.sub !== sub || intent.authVersion !== local.authVersion
      || intent.status !== 'prepared' || intent.expiresAt <= Date.now()) {
      throw new OAuthError('AUTHORIZATION_USED', 'Esta solicitação expirou ou já foi usada.', 409);
    }
    if (capabilities) {
      const ref = connectionRef(connectionId(sub, intent.authorization.client.id));
      const existing = (await tx.get(ref)).data() as Connection | undefined;
      if (existing && existing.status !== 'revoked') {
        throw new OAuthError('RECONSENT_REQUIRED', 'Revogue a conexão existente antes de autorizar novamente.', 409);
      }
      const validAfter = Math.floor(Date.now() / 1000) + 1;
      tx.set(ref, { userId: local.user.id, sub, clientId: intent.authorization.client.id,
        clientName: intent.authorization.client.name, capabilities, status: 'pending',
        authVersion: local.authVersion, validAfter, approvedAt: null, revokedAt: null, approvalId } satisfies Connection);
    }
    tx.update(requestRef, { status: 'processing' });
    return { intent, approvalId };
  });
}
export async function completeApproval(id: string, sub: string, clientId: string, approvalId: string) {
  await adminDb.runTransaction(async tx => {
    const ref = connectionRef(connectionId(sub, clientId));
    const snapshot = await tx.get(ref);
    if (snapshot.data()?.status !== 'pending' || snapshot.data()?.approvalId !== approvalId) {
      throw new OAuthError('AUTHORIZATION_INTERRUPTED', 'A autorização foi interrompida.', 409);
    }
    tx.update(ref, { status: 'active', approvedAt: Date.now() });
    tx.update(intentRef(id), { status: 'approved' });
  });
}
export async function rollbackApproval(id: string, session: ProviderSession, clientId: string, approvalId: string) {
  const ref = connectionRef(connectionId(session.sub, clientId));
  const owns = await adminDb.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (snap.data()?.approvalId !== approvalId || snap.data()?.status !== 'pending') return false;
    tx.update(ref, { status: 'revocation_pending', revokedAt: Date.now() });
    tx.update(intentRef(id), { status: 'failed' });
    return true;
  });
  if (!owns) return;
  await finishRevocation(ref.id, session);
}
async function finishRevocation(id: string, session: ProviderSession) {
  const ref = connectionRef(id);
  const attempt = randomUUID();
  // Durable ownership prevents a late concurrent revoke from deleting a newly issued provider grant.
  // A process crash leaves this blocked for operator recovery; never expire this lock into a new grant.
  const connection = await adminDb.runTransaction(async tx => {
    const data = (await tx.get(ref)).data() as Connection;
    if (data.status !== 'revocation_pending') return null;
    if (data.revocationAttempt) throw new OAuthError('REVOCATION_BUSY', 'A revogação está em andamento. Tente novamente em instantes.', 409);
    tx.update(ref, { revocationAttempt: attempt });
    return data;
  });
  if (!connection) return;
  try {
    await getOAuthProvider().revokeGrant(session, connection.clientId);
    await adminDb.runTransaction(async tx => {
      const current = (await tx.get(ref)).data();
      if (current?.status === 'revocation_pending' && current.approvalId === connection.approvalId && current.revocationAttempt === attempt) {
        tx.update(ref, { status: 'revoked', revocationAttempt: null });
      }
    });
  } catch (error) {
    // Timeout/disconnect may leave the provider request running. Do not unlock it for a retry/reconnect.
    if (error instanceof RevocationNotSentError) await adminDb.runTransaction(async tx => {
      const current = (await tx.get(ref)).data();
      if (current?.status === 'revocation_pending' && current.approvalId === connection.approvalId && current.revocationAttempt === attempt) {
        tx.update(ref, { revocationAttempt: null });
      }
    });
    throw error;
  }
}
export async function revokeOwnedConnection(id: string, local: SessionPayload) {
  const ref = connectionRef(id);
  // This transaction is deliberately before identity lookup, OTP or any provider request.
  const connection = await adminDb.runTransaction(async tx => {
    const data = (await tx.get(ref)).data() as Connection | undefined;
    if (!data || data.userId !== local.user.id) throw new OAuthError('CONNECTION_NOT_FOUND', 'Conexão não encontrada.', 404);
    if (data.status === 'pending') throw new OAuthError('AUTHORIZATION_BUSY', 'Uma autorização está em andamento. Tente revogar novamente em instantes.', 409);
    if (data.status === 'revoked') return null;
    if (data.revocationAttempt) throw new OAuthError('REVOCATION_BUSY', 'O acesso está bloqueado. Há uma revogação em andamento; se ela não terminar, solicite suporte.', 409);
    tx.update(ref, { status: 'revocation_pending', revokedAt: Date.now() });
    return data;
  });
  if (!connection) return;
  let session: ProviderSession | undefined;
  try {
    const identity = await boundIdentity(local.user.id);
    if (!identity || identity.sub !== connection.sub) throw new OAuthError('IDENTITY_COLLISION', 'Identidade da conexão inválida.', 409);
    session = await getOAuthProvider().createSession(identity);
    await finishRevocation(id, session);
  } catch (error) {
    if (error instanceof OAuthError && error.status === 409) throw error;
    throw new OAuthError('REVOCATION_PENDING', 'O acesso local foi bloqueado. Tente novamente; se a revogação continuar em andamento, solicite suporte.', 503);
  } finally {
    if (session) await getOAuthProvider().signOut(session).catch(() => undefined);
  }
}
export async function listOwnedConnections(userId: string) {
  const snapshot = await adminDb.collection('mcpConnections').where('userId', '==', userId).get();
  return snapshot.docs.map(doc => {
    const data = doc.data() as Connection;
    // Deliberately omits sub and approvalId: the provider subject and the approval reference are not
    // the user's business and would travel to the browser for nothing.
    return { id: doc.id, clientName: data.clientName, capabilities: data.capabilities, status: data.status,
      approvedAt: data.approvedAt, revokedAt: data.revokedAt, lastSeenAt: data.lastSeenAt ?? null };
  });
}
