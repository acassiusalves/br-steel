import 'server-only';
import { z } from 'zod';
import type { AccessContext, Capability } from '@/server/access/types';
import type { OperationResult } from '@/types/operations';
import { findUserById } from '@/server/access/users';
import { mcpCapabilities } from '@/lib/mcp-capabilities';
import { dateSchema, documentIdSchema, requireOperation, result, OperationError, serialize } from '@/server/operations/common';
import { listSales, getSale, summarizeSales } from '@/server/operations/sales';
import { listProductStock } from '@/server/operations/stock';
import { listSupplies, listMovements } from '@/server/operations/supplies';
import { productionDemand } from '@/server/operations/production-demand';
import { listProduction, getProductionLot, getProductionOrder } from '@/server/operations/production';
import { skuHistory } from '@/server/operations/sku-history';
export type ReadToolDefinition = { name: string; title: string; description: string; capability?: Capability; page?: string; schema: z.AnyZodObject; run(context: AccessContext, input: any): Promise<OperationResult<unknown>> };
const pagination = { limit: z.number().int().min(1).max(100).default(50), cursor: z.string().max(1000).optional() };
const period = { from: dateSchema, to: dateSchema };
const paged = z.object(pagination).strict();
const pick = (value: any, fields: string[]) => Object.fromEntries(fields.filter(k => value?.[k] !== undefined && (value[k] === null || ['string','number','boolean'].includes(typeof value[k]))).map(k => [k, value[k]]));
function sale(value: any) {
 return { ...pick(value, ['id','numero','numeroLoja','data','dataSaida','dataPrevista','totalProdutos','total']), contato: pick(value.contato, ['id','nome']), situacao: pick(value.situacao, ['id','nome','valor']), loja: pick(value.loja, ['id','nome']) };
}
function arrayPage<T>(rows: T[], input: { limit: number; cursor?: string }) {
 let offset = 0;
 if (input.cursor) { if (!/^\d+$/.test(input.cursor)) throw new OperationError('INVALID_CURSOR', 'Paginação inválida.'); offset = Number(input.cursor); if (!Number.isSafeInteger(offset)) throw new OperationError('INVALID_CURSOR', 'Paginação inválida.'); }
 return { data: rows.slice(offset, offset + input.limit), nextCursor: offset + input.limit < rows.length ? String(offset + input.limit) : null };
}
async function myAccess(context: AccessContext) {
 if (!context.active || context.mustChangePassword || context.actor.source !== 'mcp' || !context.actor.clientId) throw new OperationError('FORBIDDEN', 'Acesso MCP indisponível.', 403);
 const user = await findUserById(context.actor.userId);
 if (!user || user.active === false || user.mustChangePassword || user.role !== context.actor.role) throw new OperationError('FORBIDDEN', 'Usuário indisponível.', 403);
 const capabilities: Capability[] = [], pages = new Set<string>();
 for (const definition of mcpCapabilities.filter(c => !c.write)) for (const page of definition.pages) {
  try { requireOperation(context, definition.key, page); if (!capabilities.includes(definition.key)) capabilities.push(definition.key); pages.add(page); } catch { /* Only effective permissions are exposed. */ }
 }
 return result({ name: user.name, role: user.role, capabilities, pages: [...pages] });
}
const defaultReadOperations = { listSales,getSale,summarizeSales,listProductStock,listSupplies,listMovements,productionDemand,listProduction,getProductionLot,getProductionOrder,skuHistory };
export type ReadOperations = typeof defaultReadOperations;
export function createReadTools(operations: ReadOperations = defaultReadOperations): ReadToolDefinition[] {
const { listSales,getSale,summarizeSales,listProductStock,listSupplies,listMovements,productionDemand,listProduction,getProductionLot,getProductionOrder,skuHistory } = operations;
const definitions: ReadToolDefinition[] = [
 { name: 'consultar_meu_acesso', title: 'Meu acesso', description: 'Consulta nome e permissões efetivas de leitura do usuário autenticado.', schema: z.object({}).strict(), run: myAccess },
 { name: 'listar_pedidos', title: 'Pedidos', description: 'Lista pedidos com dados comerciais mínimos e paginação.', capability: 'vendas:read', schema: paged.extend({ from: dateSchema.optional(), to: dateSchema.optional(), storeId: z.number().int().optional(), statusId: z.number().int().optional() }).strict(), run: async (ctx, input) => { const r = await listSales(ctx,input); return { ...r, data: r.data.map(sale) }; } },
 { name: 'consultar_pedido', title: 'Detalhes do pedido', description: 'Consulta dados comerciais e uma página dos itens do pedido.', capability: 'vendas:read', schema: paged.extend({ id: documentIdSchema }).strict(), run: async (ctx,input) => { const r = await getSale(ctx,input.id); const p = arrayPage(r.data.itens ?? [], input); return { ...r, data: { ...sale(r.data), itens: p.data.map(i => pick(i,['id','codigo','descricao','unidade','quantidade','valor','desconto'])) }, nextCursor: p.nextCursor }; } },
 { name: 'resumir_vendas', title: 'Resumo de vendas', description: 'Resume pedidos salvos no banco de dados do sistema no período e compara com período anterior de mesma duração. Não consulta o Bling; totais zerados ou ausência de base anterior não diagnosticam falha de integração.', capability: 'vendas:read', schema: z.object(period).strict(), run: async (ctx,input) => { const r = await summarizeSales(ctx,input); return { ...r, data: { ...r.data, salesByState: r.data.salesByState.slice(0,100) }, warnings: [...r.warnings, ...(r.data.salesByState.length > 100 ? ['Distribuição por estado limitada a 100 entradas.'] : [])] }; } },
 { name: 'consultar_estoque_produtos', title: 'Estoque de produtos', description: 'Consulta exclusivamente saldos de produtos salvos no banco de dados do sistema, com a data da observação. Não consulta o Bling nem seu cache. Saldos desconhecidos são nulos; ausência de registros não indica falha de integração.', capability: 'estoque:read', schema: paged.extend({ sku: z.string().max(200).optional() }).strict(), run: listProductStock },
 { name: 'listar_insumos', title: 'Insumos', description: 'Lista cadastro, saldos e limites de insumos.', capability: 'insumos:read', schema: paged, run: async (ctx,input) => { const r = await listSupplies(ctx,input); return { ...r, data: r.data.map(i => pick(i,['id','nome','codigo','gtin','unidade','precoCusto','estoqueAtual','estoqueMinimo','estoqueMaximo','tempoEntrega'])) }; } },
 { name: 'listar_movimentacoes_insumo', title: 'Histórico do insumo', description: 'Lista movimentações no período opcional, por dias civis de America/Sao_Paulo.', capability: 'insumos:read', schema: paged.extend({ supplyId: documentIdSchema, from: dateSchema.optional(), to: dateSchema.optional() }).strict(), run: async (ctx,input) => { const r = await listMovements(ctx,input); return { ...r, data: r.data.map(i => pick(i,['id','supplyId','type','quantity','unitCost','notes','createdAt','balanceAfter'])) }; } },
 { name: 'consultar_demanda_producao', title: 'Demanda de produção', description: 'Calcula demanda por SKU a partir dos pedidos faturados, saldos e limites salvos no banco de dados do sistema, com paginação e sem dados financeiros ou clientes. Não consulta o Bling; estoque ausente é nulo e resultado vazio não indica falha de integração.', capability: 'producao:read', page: '/producao', schema: paged.extend(period).strict(), run: async (ctx,input) => { const r = await productionDemand(ctx,{ from: input.from, to: input.to }); return { ...r, ...arrayPage([...r.data].sort((a,b) => a.sku < b.sku ? -1 : a.sku > b.sku ? 1 : 0),input) }; } },
 { name: 'consultar_historico_sku', title: 'Histórico do SKU',
   description: 'Consulta a série semanal de demanda de um SKU, em semanas ISO de America/Sao_Paulo. Somente semanas fechadas e salvas no banco; a semana corrente acompanha consultar_demanda_producao. Série vazia indica SKU sem venda faturada consolidada, não falha de integração.',
   capability: 'producao:read', page: '/producao',
   schema: z.object({ sku: documentIdSchema, semanas: z.number().int().min(1).max(104).optional() }).strict(),
   run: skuHistory },
 {
  name: 'listar_pedidos_para_producao', title: 'Pedidos para produção',
  description: 'Lista pedidos com itens operacionais. Com orderId, limit e cursor paginam os itens desse pedido; sem orderId, paginam pedidos. Use itemsNextCursor da listagem como cursor junto ao orderId para continuar os itens.',
  capability: 'producao:read', page: '/producao/kanban', schema: paged.extend({ orderId: documentIdSchema.optional() }).strict(),
  run: async (ctx,input) => {
   if (input.orderId) {
    const response = await getProductionOrder(ctx,input);
    return { ...response, data: [{ ...response.data, itemsTruncated: response.nextCursor !== null, itemsNextCursor: response.nextCursor }] };
   }
   const response = await listProduction(ctx,{ ...input, view: 'orders' });
   const rows = response.data as any[];
   return { ...response,
    data: rows.map(row => ({ ...row, itens: row.itens.slice(0,100), itemsTruncated: row.itens.length > 100, itemsNextCursor: row.itens.length > 100 ? '100' : null })),
    warnings: [...response.warnings, ...(rows.some(row => row.itens.length > 100) ? ['Para consultar os itens restantes, informe orderId e itemsNextCursor como cursor nesta ferramenta.'] : [])],
   };
  },
 },
 ...(['columns','lots'] as const).map((view,index): ReadToolDefinition => ({
  name: ['listar_colunas_producao','listar_lotes_producao'][index], title: ['Colunas de produção','Lotes de produção'][index],
  description: 'Consulta dados operacionais mínimos do Kanban com paginação.', capability: 'producao:read', page: '/producao/kanban', schema: paged,
  run: async (ctx,input) => {
   const response = await listProduction(ctx,{ ...input, view });
   if (view !== 'lots') return response;
   const rows = response.data as any[];
   return { ...response, data: rows.map(row => ({ ...row, linkedOrderIds: Array.isArray(row.linkedOrderIds) ? row.linkedOrderIds.slice(0,100) : [] })), warnings: [...response.warnings, ...(rows.some(row => row.linkedOrderIds?.length > 100) ? ['Pedidos vinculados limitados a 100 entradas.'] : [])] };
  },
 })),
 { name: 'consultar_lote_producao', title: 'Detalhes do lote', description: 'Consulta lote e uma página dos itens operacionais, sem dados financeiros ou clientes.', capability: 'producao:read', page: '/producao/kanban', schema: paged.extend({ lotId: documentIdSchema }).strict(), run: getProductionLot },
];
// Keep direct invocation as strict as transport invocation.
return definitions.map(definition => ({ ...definition, run: async (context: AccessContext, input: unknown) => {
 if (definition.capability) requireOperation(context, definition.capability, definition.page);
 return serialize(await definition.run(context, definition.schema.parse(input)));
} }));

}
export const readTools = createReadTools();
