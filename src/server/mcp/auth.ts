import 'server-only';
import { validateOAuthPrincipal } from '@/server/oauth/access-token';
import { getMcpConfig } from './config';
import { McpHttpError } from './errors';
export type McpPrincipal = Awaited<ReturnType<typeof validateOAuthPrincipal>>;
export async function authenticateMcp(request: Request): Promise<McpPrincipal> {
  const config = getMcpConfig();
  const header = request.headers.get('authorization');
  const match = header?.match(/^Bearer ([A-Za-z0-9._~-]+)$/i);
  if (!match) throw new McpHttpError('INVALID_TOKEN', 'Autenticação OAuth necessária.', 401);
  let principal: McpPrincipal;
  try { principal = await validateOAuthPrincipal(match[1]); }
  catch { throw new McpHttpError('INVALID_TOKEN', 'A conexão expirou ou não está autorizada.', 401); }
  if (!config.allowedUserIds.has(principal.context.actor.userId)) throw new McpHttpError('PILOT_RESTRICTED', 'Usuário ainda não habilitado para este conector.', 403);
  return principal;
}
