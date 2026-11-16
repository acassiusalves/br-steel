import { expect, it } from 'vitest';
import { requireCapability, canAccessPage } from '@/server/access/policy';
import type { AccessContext } from '@/server/access/types';
import { pagePermissions } from '@/lib/permissions';
const context = (role: string): AccessContext => ({
  actor: { userId: 'u', role, source: 'mcp', clientId: 'c' }, active: true,
  capabilities: ['vendas:read', 'estoque:read', 'producao:write'], permissions: pagePermissions, inactivePages: [],
});
it('lets a seller read sales but not mutate production merely because stock is allowed', () => {
  expect(() => requireCapability(context('Vendedor'), 'vendas:read', '/vendas')).not.toThrow();
  expect(() => requireCapability(context('Vendedor'), 'producao:write', '/producao/kanban')).toThrow();
});
it('intersects connection capabilities with current pages and explicit write roles', () => {
  const c = context('Operador');
  expect(() => requireCapability(c, 'producao:write', '/producao/kanban')).not.toThrow();
  expect(() => requireCapability({ ...c, capabilities: [] }, 'producao:write', '/producao/kanban')).toThrow();
  expect(() => requireCapability({ ...c, inactivePages: ['/producao/kanban'] }, 'producao:write', '/producao/kanban')).toThrow();
  expect(() => requireCapability({ ...c, active: false }, 'producao:write', '/producao/kanban')).toThrow();
  expect(() => requireCapability({ ...c, mustChangePassword: true }, 'producao:write', '/producao/kanban')).toThrow();
  expect(() => requireCapability(c, 'producao:write', '/vendas')).toThrow();
});

it('never treats inherited object properties as pages', () => {
  expect(canAccessPage({ role: 'Administrador' }, context('Administrador'), '__proto__')).toBe(false);
  expect(canAccessPage({ role: 'Administrador' }, context('Administrador'), 'constructor')).toBe(false);
});

it('the Produção role (badge accounts) only reaches the OP board, the profile and its own reports, whatever the settings say', () => {
  const settings = { permissions: { ...pagePermissions, '/producao/quadro': ['Administrador', 'Operador'], '/estoque': ['Produção'] }, inactivePages: [] };
  for (const page of ['/producao/quadro', '/perfil', '/meus-reportes']) expect(canAccessPage({ role: 'Produção' }, settings, page)).toBe(true);
  for (const page of ['/estoque', '/atendimento/chat', '/insumos', '/producao/ops', '/producao/engenharia', '/vendas', '/configuracoes']) {
    expect(canAccessPage({ role: 'Produção' }, settings, page)).toBe(false);
  }
  const c = context('Produção');
  expect(() => requireCapability(c, 'producao:write', '/producao/quadro')).not.toThrow();
  expect(() => requireCapability(c, 'producao:write', '/producao/ops')).toThrow();
  expect(() => requireCapability({ ...c, inactivePages: ['/producao/quadro'] }, 'producao:write', '/producao/quadro')).toThrow();
});
