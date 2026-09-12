import 'server-only';
import { z } from 'zod';
import { getSessionFromRequest, loadAppAccessSettings } from '@/lib/server-auth';
import { authorizationIdPattern } from '@/lib/oauth-return-path';
import { mcpCapabilities } from '@/lib/mcp-capabilities';
import { requireCapability } from '@/server/access/policy';
import type { Capability } from '@/server/access/types';
import { getOAuthConfig } from './config';
import { getOAuthProvider } from './supabase';
import { boundIdentity, ensureOAuthIdentity } from './identity-bridge';
import { OAuthError } from './errors';
import { openBridgeSession, sealBridgeSession } from './cookies';
import { beginDecision, completeApproval, connectionId, connectionRef, intentRef, readIntent, rollbackApproval, storeIntent } from './grants';

export const authorizationIdSchema = z.string().regex(authorizationIdPattern);
const detailSchema = z.object({
  authorization_id: authorizationIdSchema,
  redirect_uri: z.string().url().max(4096),
  client: z.object({ id: z.string().uuid(), name: z.string().max(200), uri: z.string().optional().default(''), logo_uri: z.string().optional().default('') }),
  user: z.object({ id: z.string().uuid(), email: z.string() }), scope: z.string().max(500),
});
export async function requireOAuthUser(request: Request) {
  getOAuthConfig();
  const local = await getSessionFromRequest(request);
  if (!local) throw new OAuthError('LOGIN_REQUIRED', 'Faça login no BR Steel para continuar.', 401);
  if (local.user.mustChangePassword) throw new OAuthError('PASSWORD_CHANGE_REQUIRED', 'Cadastre uma senha pessoal antes de conectar o Claude.', 403);
  return local;
}
export async function eligibleCapabilities(local: Awaited<ReturnType<typeof requireOAuthUser>>) {
  const settings = await loadAppAccessSettings();
  const context = { ...settings, actor: { userId: local.user.id, role: local.user.role, source: 'web' as const },
    active: local.user.active !== false, mustChangePassword: local.user.mustChangePassword,
    capabilities: mcpCapabilities.map(item => item.key) };
  return mcpCapabilities.filter(capability => {
    if (capability.write && process.env.MCP_WRITES_ENABLED !== 'true') return false;
    return capability.pages.some(page => { try { requireCapability(context, capability.key, page); return true; } catch { return false; } });
  });
}
function callbackUrl(raw: string) {
  const url = new URL(raw);
  if (url.username || url.password || url.hash || (url.protocol !== 'https:'
    && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) {
    throw new OAuthError('CALLBACK_INVALID', 'O destino informado pelo provedor é inválido.', 400);
  }
  return url;
}
export function validateProviderRedirect(raw: string, registered: string) {
  const actual = callbackUrl(raw); const expected = callbackUrl(registered);
  if (actual.origin !== expected.origin || actual.pathname !== expected.pathname
    || [...expected.searchParams.keys()].some(key => JSON.stringify(actual.searchParams.getAll(key)) !== JSON.stringify(expected.searchParams.getAll(key)))) {
    throw new OAuthError('CALLBACK_INVALID', 'O retorno da autorização não corresponde ao aplicativo.', 400);
  }
  return actual.href;
}
export async function establishConsentSession(request: Request, authorizationId: string) {
  authorizationIdSchema.parse(authorizationId);
  const local = await requireOAuthUser(request);
  const identity = await ensureOAuthIdentity(local.user);
  const provider = getOAuthProvider();
  const session = await provider.createSession(identity);
  if (session.sub !== identity.sub) throw new OAuthError('BRIDGE_MISMATCH', 'Identidade de sessão inválida.', 401);
  const result = await provider.getAuthorizationDetails(session, authorizationId);
  if (!('authorization_id' in result)) {
    await provider.signOut(session).catch(() => undefined);
    throw new OAuthError('RECONSENT_REQUIRED', 'Esta conexão já tem uma autorização. Revogue a conexão abaixo e reinicie a conexão no Claude para revisar as permissões.', 409);
  }
  const details = detailSchema.parse(result);
  if (details.authorization_id !== authorizationId || details.user.id !== identity.sub) throw new OAuthError('BRIDGE_MISMATCH', 'A solicitação não corresponde ao usuário.', 401);
  callbackUrl(details.redirect_uri);
  await storeIntent(local, identity.sub, details);
  return sealBridgeSession(session, local);
}
export async function authorizedBridge(request: Request) {
  const local = await requireOAuthUser(request);
  const session = await openBridgeSession(request, local);
  const identity = await boundIdentity(local.user.id);
  if (!identity || identity.sub !== session.sub || (await getOAuthProvider().getUser(session)).sub !== identity.sub) {
    throw new OAuthError('BRIDGE_MISMATCH', 'A sessão do conector não corresponde ao usuário.', 401);
  }
  return { local, session };
}
export async function getAuthorization(request: Request, authorizationId: string) {
  authorizationIdSchema.parse(authorizationId);
  const { local, session } = await authorizedBridge(request);
  const intent = await readIntent(authorizationId, local, session.sub);
  return { user: { name: local.user.name, email: local.user.email }, authorization: intent.authorization,
    capabilities: (await eligibleCapabilities(local)).map(({ key, label, description, write }) => ({ key, label, description, write })) };
}
export async function decideAuthorization(request: Request, authorizationId: string, decision: 'approve' | 'deny', capabilities: Capability[]) {
  const { local, session } = await authorizedBridge(request);
  const allowed = await eligibleCapabilities(local);
  if (decision === 'approve' && (!capabilities.length || capabilities.some(cap => !allowed.some(item => item.key === cap)))) {
    throw new OAuthError('CAPABILITY_DENIED', 'Você não tem permissão para todas as operações selecionadas.', 403);
  }
  const { intent, approvalId } = await beginDecision(authorizationId, local, session.sub, decision === 'approve' ? [...new Set(capabilities)] : null);
  const provider = getOAuthProvider();
  if (decision === 'deny') {
    try {
      const redirect = validateProviderRedirect(await provider.denyAuthorization(session, authorizationId), intent.authorization.redirect_uri);
      await intentRef(authorizationId).update({ status: 'denied' });
      return redirect;
    } catch (error) { await intentRef(authorizationId).update({ status: 'failed' }); throw error; }
  }
  try {
    const ref = connectionRef(connectionId(session.sub, intent.authorization.client.id));
    const validAfter = (await ref.get()).data()!.validAfter as number;
    // JWT iat has second precision: cross that boundary before issuing the next generation.
    await new Promise(resolve => setTimeout(resolve, Math.max(0, validAfter * 1000 - Date.now())));
    // A password/role change while waiting must also prevent approval.
    const current = await requireOAuthUser(request);
    const currentAllowed = await eligibleCapabilities(current);
    if (current.authVersion !== local.authVersion || capabilities.some(cap => !currentAllowed.some(item => item.key === cap))) {
      throw new OAuthError('CAPABILITY_DENIED', 'Suas permissões mudaram. Inicie novamente.', 403);
    }
    const redirect = validateProviderRedirect(await provider.approveAuthorization(session, authorizationId), intent.authorization.redirect_uri);
    await completeApproval(authorizationId, session.sub, intent.authorization.client.id, approvalId);
    return redirect;
  } catch (error) {
    await rollbackApproval(authorizationId, session, intent.authorization.client.id, approvalId).catch(() => undefined);
    throw error;
  }
}
