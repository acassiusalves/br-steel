
// src/lib/permissions.ts

export const availableRoles = [
    { key: 'Administrador', name: 'Administrador' },
    { key: 'Vendedor', name: 'Vendedor' },
    { key: 'Operador', name: 'Operador' },
];

export const pagePermissions: Record<string, string[]> = {
    '/vendas': ['Administrador', 'Vendedor'],
    '/producao': ['Administrador', 'Operador'],
    '/producao/kanban': ['Administrador', 'Operador'],
    '/insumos': ['Administrador', 'Operador'],
    '/produtos': ['Administrador', 'Operador', 'Vendedor'],
    '/estoque': ['Administrador', 'Operador', 'Vendedor'],
    '/atendimento/chat': ['Administrador', 'Operador', 'Vendedor'],
    '/anuncios-mercado-livre': ['Administrador', 'Operador', 'Vendedor'],
    '/analise-ads': ['Administrador', 'Operador', 'Vendedor'],
    '/buscar-mercado-livre': ['Administrador', 'Operador', 'Vendedor'],
    '/configuracoes': ['Administrador'],
    '/api-settings': ['Administrador'],
    '/perfil': ['Administrador', 'Vendedor', 'Operador'],
};
