// src/lib/permissions.ts

export const availableRoles = [
    { key: 'Administrador', name: 'Administrador' },
    { key: 'Vendedor', name: 'Vendedor' },
    { key: 'Operador', name: 'Operador' },
];

export const pagePermissions: Record<string, string[]> = {
    '/vendas': ['Administrador', 'Vendedor'],
    '/producao': ['Administrador', 'Operador'],
    '/insumos': ['Administrador', 'Operador'],
    '/estoque': ['Administrador', 'Operador', 'Vendedor'],
    '/api': ['Administrador'],
    '/configuracoes': ['Administrador'],
    '/perfil': ['Administrador', 'Vendedor', 'Operador'],
};
