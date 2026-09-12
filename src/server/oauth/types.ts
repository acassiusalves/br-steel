import type { OAuthAuthorizationDetails, OAuthRedirect } from '@supabase/supabase-js';
import type { SessionUser } from '@/lib/server-auth';
export type { OAuthAuthorizationDetails };
export interface OAuthIdentity { sub: string; email: string; }
export interface ProviderSession { sub: string; access_token: string; refresh_token: string; expires_at: number; }
export interface OAuthProvider {
  ensureIdentity(sub: string, user: SessionUser): Promise<OAuthIdentity>;
  createSession(identity: OAuthIdentity): Promise<ProviderSession>;
  getUser(session: ProviderSession): Promise<{ sub: string }>;
  getAuthorizationDetails(session: ProviderSession, authorizationId: string): Promise<OAuthAuthorizationDetails | OAuthRedirect>;
  approveAuthorization(session: ProviderSession, authorizationId: string): Promise<string>;
  denyAuthorization(session: ProviderSession, authorizationId: string): Promise<string>;
  revokeGrant(session: ProviderSession, clientId: string): Promise<void>;
  signOut(session: ProviderSession): Promise<void>;
}
