import type { Capability } from '@/server/access/types';
export const mcpCapabilities: Array<{ key: Capability; label: string; description: string; pages: string[]; write: boolean; writeRoles?: string[] }> = [
  { key: 'vendas:read', label: 'Consultar vendas', description: 'Pedidos e resumos de vendas.', pages: ['/vendas'], write: false },
  { key: 'vendas:sync', label: 'Sincronizar vendas', description: 'Importar pedidos do Bling para o BR Steel.', pages: ['/vendas'], write: true, writeRoles: ['Administrador', 'Vendedor'] },
  { key: 'estoque:read', label: 'Consultar estoque', description: 'Saldos e disponibilidade de produtos.', pages: ['/estoque'], write: false },
  { key: 'insumos:read', label: 'Consultar insumos', description: 'Cadastro, limites e histórico de movimentações.', pages: ['/insumos'], write: false },
  { key: 'insumos:write', label: 'Movimentar insumos', description: 'Registrar entradas e saídas e ajustar limites locais.', pages: ['/insumos'], write: true, writeRoles: ['Administrador', 'Operador'] },
  { key: 'producao:read', label: 'Consultar produção', description: 'Lotes, itens e andamento no Kanban.', pages: ['/producao', '/producao/kanban'], write: false },
  { key: 'producao:write', label: 'Alterar produção', description: 'Criar lotes e atualizar seu andamento.', pages: ['/producao', '/producao/kanban'], write: true, writeRoles: ['Administrador', 'Operador'] },
];
