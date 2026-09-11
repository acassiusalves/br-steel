import { pagePermissions, availableRoles } from '@/lib/permissions';
import type { AccessContext, AccessSettings, Capability } from './types';

export function canAccessPage(user: { role: string; active?: boolean; mustChangePassword?: boolean }, settings: AccessSettings, page: string) {
  return user.active !== false && availableRoles.some(r => r.key === user.role)
    && Object.hasOwn(pagePermissions, page) && !settings.inactivePages.includes(page)
    && (!user.mustChangePassword || page === '/perfil')
    && (user.role === 'Administrador' || settings.permissions[page]?.includes(user.role) === true);
}
const capabilityPages: Record<Capability, string[]> = {
  'vendas:read': ['/vendas'], 'vendas:sync': ['/vendas'], 'estoque:read': ['/estoque'],
  'insumos:read': ['/insumos'], 'insumos:write': ['/insumos'],
  'producao:read': ['/producao', '/producao/kanban'], 'producao:write': ['/producao', '/producao/kanban'],
};
const writeRoles: Partial<Record<Capability, string[]>> = {
  'vendas:sync': ['Administrador', 'Vendedor'],
  'insumos:write': ['Administrador', 'Operador'],
  'producao:write': ['Administrador', 'Operador'],
};
export function requireCapability(context: AccessContext, capability: Capability, page: string) {
  if (!context.capabilities.includes(capability) || !capabilityPages[capability]?.includes(page)
    || !canAccessPage({ role: context.actor.role, active: context.active, mustChangePassword: context.mustChangePassword }, context, page)
    || (writeRoles[capability] && !writeRoles[capability]!.includes(context.actor.role))) {
    throw new Error('Sem permissão para esta operação.');
  }
}
