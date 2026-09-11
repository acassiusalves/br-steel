import 'server-only';
import { getOAuthConfig } from '@/server/oauth/config';
import { McpHttpError } from './errors';
export const MAX_BODY_BYTES = 64 * 1024;
export const MAX_OUTPUT_BYTES = 256 * 1024;
export const READS_PER_MINUTE = 60;
export const AUDIT_RETENTION_DAYS = 90;
export function getMcpConfig() {
  if (process.env.MCP_ENABLED !== 'true') throw new McpHttpError('DISABLED', 'Conector indisponível neste ambiente.', 503);
  try {
    const oauth = getOAuthConfig();
    const allowedOrigins = new Set([oauth.appOrigin]);
    for (const origin of (process.env.MCP_ALLOWED_ORIGINS ?? '').split(',').map(v => v.trim()).filter(Boolean)) {
      const url = new URL(origin);
      if (url.origin !== origin || url.username || url.password || (url.protocol !== 'https:'
        && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) throw new Error('Invalid origin');
      allowedOrigins.add(origin);
    }
    return { resource: oauth.resource, issuer: oauth.issuer, appOrigin: oauth.appOrigin,
      metadataUrl: `${oauth.appOrigin}/.well-known/oauth-protected-resource/api/mcp`, allowedOrigins,
      allowedUserIds: new Set((process.env.MCP_ALLOWED_USER_IDS ?? '').split(',').map(id => id.trim()).filter(Boolean)) };
  } catch { throw new McpHttpError('CONFIGURATION', 'Conector indisponível neste ambiente.', 503); }
}
export type McpConfig = ReturnType<typeof getMcpConfig>;
