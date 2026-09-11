import { mcpCapabilities } from '@/lib/mcp-capabilities';
import { pagePermissions, availableRoles } from '@/lib/permissions';
import type { AccessContext, AccessSettings, Capability } from './types';

export function canAccessPage(user: { role: string; active?: boolean; mustChangePassword?: boolean }, settings: AccessSettings, page: string) {
  return user.active !== false && availableRoles.some(r => r.key === user.role)
    && Object.hasOwn(pagePermissions, page) && !settings.inactivePages.includes(page)
    && (!user.mustChangePassword || page === '/perfil')
    && (user.role === 'Administrador' || settings.permissions[page]?.includes(user.role) === true);
}
export function requireCapability(context: AccessContext, capability: Capability, page: string) {
  const definition = mcpCapabilities.find(item => item.key === capability);
  if (!context.capabilities.includes(capability) || !definition?.pages.includes(page)
    || !canAccessPage({ role: context.actor.role, active: context.active, mustChangePassword: context.mustChangePassword }, context, page)
    || (definition.writeRoles && !definition.writeRoles.includes(context.actor.role))) {
    throw new Error('Sem permissão para esta operação.');
  }
}
