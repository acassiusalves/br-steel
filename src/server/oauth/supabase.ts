import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { getOAuthConfig } from './config';
import { OAuthError, RevocationNotSentError } from './errors';
import type { OAuthProvider, ProviderSession } from './types';

function providerFailure() { return new OAuthError('PROVIDER_UNAVAILABLE', 'Não foi possível concluir a solicitação no provedor. Tente novamente.', 503); }
export function getOAuthProvider(): OAuthProvider {
  const config = getOAuthConfig();
  const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, { ...init, signal: AbortSignal.timeout(15000) }) } };
  const admin = () => createClient(config.supabaseUrl, config.secretKey, options);
  const client = () => createClient(config.supabaseUrl, config.publishableKey, options);
  async function authenticated(session: ProviderSession) {
    if (session.expires_at <= Math.floor(Date.now() / 1000)) throw new OAuthError('BRIDGE_EXPIRED', 'A sessão do conector expirou. Inicie novamente.', 401);
    const scoped = client();
    const { data, error } = await scoped.auth.setSession(session);
    if (error || data.user?.id !== session.sub) throw new OAuthError('BRIDGE_MISMATCH', 'A sessão do conector não corresponde ao usuário.', 401);
    return scoped;
  }
  return {
    async ensureIdentity(sub, user) {
      const api = admin().auth.admin;
      let result = await api.getUserById(sub);
      if (result.error && result.error.status !== 404) throw providerFailure();
      if (!result.data.user) {
        result = await api.createUser({ id: sub, email: user.email, email_confirm: true,
          app_metadata: { brsteel_user_id: user.id, brsteel_mcp_resource: config.resource }, user_metadata: { name: user.name } });
        if (result.error) {
          // Another attempt may have completed the same reserved ID. Never adopt by email.
          result = await api.getUserById(sub);
          if (result.error || !result.data.user) throw new OAuthError('IDENTITY_COLLISION', 'Não foi possível vincular esta identidade. Verifique o cadastro antes de tentar novamente.', 409);
        }
      }
      const external = result.data.user;
      const marker = external?.app_metadata?.brsteel_mcp_resource;
      const resourceUrl = new URL(config.resource);
      const legacyAllowed = config.resource === 'https://br-steel-mcp-staging.vercel.app/api/mcp'
        || ['localhost', '127.0.0.1'].includes(resourceUrl.hostname);
      const resourceMatches = marker === config.resource || (marker === undefined && legacyAllowed);
      if (!resourceMatches || external?.id !== sub || external.app_metadata.brsteel_user_id !== user.id || !external.email) {
        throw new OAuthError('IDENTITY_COLLISION', 'Identidade já vinculada a outro cadastro.', 409);
      }
      return { sub, email: external.email };
    },
    async createSession(identity) {
      const { data: link, error: linkError } = await admin().auth.admin.generateLink({ type: 'magiclink', email: identity.email });
      if (linkError || link.user?.id !== identity.sub || !link.properties?.hashed_token) throw providerFailure();
      const { data, error } = await client().auth.verifyOtp({ type: 'magiclink', token_hash: link.properties.hashed_token });
      if (error || data.user?.id !== identity.sub || !data.session?.expires_at) throw providerFailure();
      return { sub: identity.sub, access_token: data.session.access_token, refresh_token: data.session.refresh_token, expires_at: data.session.expires_at };
    },
    async getUser(session) {
      const { data, error } = await (await authenticated(session)).auth.getUser();
      if (error || data.user?.id !== session.sub) throw new OAuthError('BRIDGE_MISMATCH', 'A sessão do conector expirou.', 401);
      return { sub: data.user.id };
    },
    async getAuthorizationDetails(session, authorizationId) {
      const { data, error } = await (await authenticated(session)).auth.oauth.getAuthorizationDetails(authorizationId);
      if (error || !data) throw new OAuthError('AUTHORIZATION_EXPIRED', 'Esta solicitação expirou ou já foi usada. Inicie uma nova conexão no Claude.', 400);
      return data;
    },
    async approveAuthorization(session, authorizationId) {
      const { data, error } = await (await authenticated(session)).auth.oauth.approveAuthorization(authorizationId, { skipBrowserRedirect: true });
      if (error || !data?.redirect_url) throw providerFailure();
      return data.redirect_url;
    },
    async denyAuthorization(session, authorizationId) {
      const { data, error } = await (await authenticated(session)).auth.oauth.denyAuthorization(authorizationId, { skipBrowserRedirect: true });
      if (error || !data?.redirect_url) throw providerFailure();
      return data.redirect_url;
    },
    async revokeGrant(session, clientId) {
      let scoped;
      try { scoped = await authenticated(session); }
      catch { throw new RevocationNotSentError(); }
      // Any failure after dispatch can be ambiguous; the durable lock must remain held.
      const { error } = await scoped.auth.oauth.revokeGrant({ clientId });
      if (error && error.status !== 404) throw providerFailure();
    },
    async signOut(session) { await (await authenticated(session)).auth.signOut({ scope: 'local' }); },
  };
}
