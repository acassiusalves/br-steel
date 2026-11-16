
// src/lib/permissions.ts

export const availableRoles = [
    { key: 'Administrador', name: 'Administrador' },
    { key: 'Vendedor', name: 'Vendedor' },
    { key: 'Operador', name: 'Operador' },
    { key: 'Produção', name: 'Produção' },
];

/**
 * Papel do chão de fábrica (líderes que entram pelo crachá no terminal da operação): só o quadro de OPs,
 * o perfil e os próprios reportes. O acesso é fixo, não muda pela tela de configurações, para que uma
 * conta de crachá nunca abra atendimento, anúncios, estoque ou insumos.
 */
export const PRODUCTION_ROLE = 'Produção';
export const FIXED_ACCESS_ROLES: readonly string[] = [PRODUCTION_ROLE];
/** Primeira tela depois do login. */
export const homePath = (role: string | undefined) => (role === PRODUCTION_ROLE ? '/producao/quadro' : '/vendas?tab=dashboard');

export const pagePermissions: Record<string, string[]> = {
    '/vendas': ['Administrador', 'Vendedor'],
    '/producao': ['Administrador', 'Operador'],
    '/producao/kanban': ['Administrador', 'Operador'],
    '/producao/engenharia': ['Administrador'],
    '/producao/ops': ['Administrador', 'Operador'],
    '/producao/quadro': ['Administrador', 'Operador', 'Produção'],
    '/insumos': ['Administrador', 'Operador'],
    '/financeiro/conciliacao': ['Administrador'],
    '/financeiro/planilhas': ['Administrador'],
    '/produtos': ['Administrador', 'Operador', 'Vendedor'],
    '/estoque': ['Administrador', 'Operador', 'Vendedor'],
    '/atendimento/chat': ['Administrador', 'Operador', 'Vendedor'],
    '/anuncios-mercado-livre': ['Administrador', 'Operador', 'Vendedor'],
    '/analise-ads': ['Administrador', 'Operador', 'Vendedor'],
    '/buscar-mercado-livre': ['Administrador', 'Operador', 'Vendedor'],
    '/configuracoes': ['Administrador'],
    '/api-settings': ['Administrador'],
    '/perfil': ['Administrador', 'Vendedor', 'Operador', 'Produção'],
    '/reportes': ['Administrador'],
    '/meus-reportes': ['Administrador', 'Vendedor', 'Operador', 'Produção'],
};
