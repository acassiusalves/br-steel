
// src/lib/permissions.ts

export const availableRoles = [
    { key: 'Administrador', name: 'Administrador' },
    { key: 'Vendedor', name: 'Vendedor' },
    { key: 'Operador', name: 'Operador' },
    // Líderes do chão de fábrica, que entram pelo crachá: só o quadro de OPs, o perfil e os próprios reportes.
    { key: 'Produção', name: 'Produção' },
];

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
