import 'server-only';
import { createHmac } from 'node:crypto';

export function signServerPayload(value: string): string {
  const secret = process.env.AUTH_SESSION_SECRET?.trim() || process.env.NEXTAUTH_SECRET?.trim();
  if (!secret && process.env.NODE_ENV === 'production') throw new Error('AUTH_SESSION_SECRET must be configured in production');
  return createHmac('sha256', secret || 'brsteel-dev-session-secret').update(value).digest('base64url');
}
