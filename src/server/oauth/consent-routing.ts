import 'server-only';
import { consentReturnPath } from '@/lib/oauth-return-path';
import { getOAuthConfig } from './config';
import { OAuthError } from './errors';
import { getOAuthProvider } from './supabase';

const origins = ['https://br-steel.vercel.app', 'https://br-steel-mcp-staging.vercel.app'];
const invalid = () => new OAuthError('AUTHORIZATION_RESOURCE_INVALID',
  'Esta solicitação não pertence a este ambiente ou expirou. Inicie novamente a conexão no Claude.', 400);

/** The provider's stored request chooses the destination, never a browser-supplied URL. */
export async function consentDestination(authorizationId: string): Promise<string | null> {
  const path = consentReturnPath(authorizationId);
  const config = getOAuthConfig();
  const resource = await getOAuthProvider().getAuthorizationResource(authorizationId);
  if (resource === config.resource) return null;
  const target = origins.find(origin => `${origin}/api/mcp` === resource);
  if (!origins.includes(config.appOrigin) || !target) throw invalid();
  return `${target}${path}`;
}

/** Reject direct session POSTs to another environment before provisioning a local identity. */
export async function requireConsentResource(authorizationId: string) {
  consentReturnPath(authorizationId);
  if (await getOAuthProvider().getAuthorizationResource(authorizationId) !== getOAuthConfig().resource) throw invalid();
}
