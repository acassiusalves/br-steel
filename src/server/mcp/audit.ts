import 'server-only';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import type { McpPrincipal } from './auth';
import { AUDIT_RETENTION_DAYS } from './config';
import { documentIdSchema } from '@/server/operations/common';
function entityFor(tool: string, args: unknown) {
  const selectors: Record<string, [string, string]> = {
    consultar_pedido: ['order', 'id'], listar_pedidos_para_producao: ['order', 'orderId'],
    consultar_lote_producao: ['productionLot', 'lotId'], listar_movimentacoes_insumo: ['supply', 'supplyId'],
    consultar_estoque_produtos: ['product', 'sku'],
  };
  const selector = selectors[tool];
  if (!selector || !args || typeof args !== 'object' || Array.isArray(args)) return null;
  const schema = selector[0] === 'product' ? z.string().min(1).max(200) : documentIdSchema;
  const id = schema.safeParse((args as Record<string, unknown>)[selector[1]]);
  return id.success ? { type: selector[0], id: id.data } : null;
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}
export async function auditRead(principal: McpPrincipal, details: {
  requestId: string; tool: string; arguments: unknown; result: 'success' | 'error' | 'denied'; durationMs: number;
}) {
  try {
    const now = Date.now();
    const { arguments: args, ...event } = details;
    // Hash arguments only: no business payload, token or provider error is persisted.
    const argumentsHash = createHash('sha256').update(JSON.stringify(canonical(args ?? {}))).digest('hex');
    await adminDb.runTransaction(async tx => {
      const connection = adminDb.collection('mcpConnections').doc(principal.connectionId);
      const snapshot = await tx.get(connection);
      tx.create(adminDb.collection('mcpAuditLogs').doc(event.requestId), { ...event,
        userId: principal.context.actor.userId, clientId: principal.context.actor.clientId, source: 'mcp',
        argumentsHash, entity: entityFor(event.tool, args), createdAt: Timestamp.fromMillis(now), expiresAt: Timestamp.fromMillis(now + AUDIT_RETENTION_DAYS * 86400000) });
      if (snapshot.exists) tx.update(connection, { lastSeenAt: now });
    });
  } catch { console.error('mcp_read_audit_failed', { requestId: details.requestId }); }
}
