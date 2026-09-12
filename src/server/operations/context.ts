import 'server-only';
import { cookies } from 'next/headers';
import { AUTH_COOKIE_NAME, getSessionFromRequest, getSessionFromToken, loadAppAccessSettings } from '@/lib/server-auth';
import { mcpCapabilities } from '@/lib/mcp-capabilities';
import type { AccessContext } from '@/server/access/types';
import { OperationError } from './common';
export async function requireWebContext(request?: Request): Promise<AccessContext> {
  const session = request ? await getSessionFromRequest(request) : await getSessionFromToken((await cookies()).get(AUTH_COOKIE_NAME)?.value);
  if (!session) throw new OperationError('UNAUTHORIZED', 'Sessão expirada. Faça login novamente.', 401);
  if (session.user.mustChangePassword) throw new OperationError('PASSWORD_CHANGE_REQUIRED', 'Cadastre uma senha pessoal para continuar.', 403);
  return { ...await loadAppAccessSettings(), actor: { userId: session.user.id, role: session.user.role, source: 'web' },
    active: session.user.active !== false, mustChangePassword: session.user.mustChangePassword, capabilities: mcpCapabilities.map(item => item.key) };
}
