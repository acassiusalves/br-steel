import 'server-only';
import { OAuthError } from './errors';
export const oauthEnabled = () => process.env.MCP_OAUTH_ENABLED === 'true';
function safeUrl(raw: string | undefined) {
  if (!raw) throw new OAuthError('CONFIGURATION', 'Conector indisponível neste ambiente.', 503);
  const url = new URL(raw);
  if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:'
    && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) {
    throw new OAuthError('CONFIGURATION', 'Configuração de URL inválida.', 503);
  }
  return url;
}
export function getOAuthConfig() {
  if (!oauthEnabled()) throw new OAuthError('DISABLED', 'O conector ainda não está habilitado.', 503);
  const app = safeUrl(process.env.APP_ORIGIN);
  const resource = safeUrl(process.env.MCP_PUBLIC_URL);
  const supabase = safeUrl(process.env.SUPABASE_URL);
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  const cookieSecret = process.env.AUTH_SESSION_SECRET;
  if (app.pathname !== '/' || supabase.pathname !== '/' || resource.href !== `${app.origin}/api/mcp`
    || !publishableKey || !secretKey || !cookieSecret || cookieSecret.length < 32) {
    throw new OAuthError('CONFIGURATION', 'Conector indisponível neste ambiente.', 503);
  }
  return { appOrigin: app.origin, resource: resource.href, supabaseUrl: supabase.origin,
    issuer: `${supabase.origin}/auth/v1`, publishableKey, secretKey, cookieSecret };
}
