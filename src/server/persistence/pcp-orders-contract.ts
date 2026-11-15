import type { OperationResult } from '@/types/operations';
import type { OrderKind, OrderSuggestion } from '@/lib/pcp/op-generator';
import type { WriteActor } from './write-audit';

export type { OrderKind, OrderSuggestion };

export type PreviewInput = { kind: OrderKind; from: string; to: string; factor: number };
export type GenerationPreview = PreviewInput & { suggestions: OrderSuggestion[]; warnings: string[]; /** Quando o mín/máx foi copiado do Bling. */ catalogSyncedAt: string };

export type BatchItem = { sku: string; sheetId: string; quantity: number; description: string | null };
export type BatchInput = PreviewInput & { items: BatchItem[] };

export type OrderStatus = 'a_produzir' | 'produzindo' | 'concluido' | 'suspenso' | 'encerrado';
export type ProductionOrderRow = {
  id: string; number: number; kind: OrderKind; sku: string; description: string | null; sheetCode: string | null;
  quantity: number; status: OrderStatus; parentOrderId: string | null; batchId: string | null; createdAt: string; stepCount: number;
};
export type BatchSummary = {
  id: string; kind: OrderKind; createdAt: string; createdBy: string; exportedAt: string | null; orderCount: number; childCount: number;
};
export type IappExport = { batchId: string; kind: OrderKind; header: readonly string[]; rows: (string | number)[][] };

/**
 * OPs do PCP, só no PostgreSQL. A prévia segue a política mín/máx: saldo do depósito Estoque lido do
 * Bling, mín/máx da cópia do cadastro do Bling, vendidos das NF-e de saída copiadas do Bling e as fichas técnicas; a geração grava o lote, as OPs e as ordens de serviço numa transação.
 */
export interface ProductionOrderRepository {
  /**
   * Lê o mín/máx do Bling (reaproveita a leitura da última hora) e o saldo do depósito Estoque, e monta a fila.
   * `actor` nulo: quem só consulta não dispara a releitura do cadastro; usa a última, com aviso.
   */
  preview(input: PreviewInput, actor: WriteActor | null): Promise<OperationResult<GenerationPreview>>;
  /** Copia do Bling o cadastro (mín/máx, formato) dos SKUs da linha oficial. Só lê o Bling. */
  syncBlingCatalog(actor: WriteActor): Promise<OperationResult<{ synced: number; missing: string[] }>>;
  createBatch(input: BatchInput, actor: WriteActor): Promise<OperationResult<{ batchId: string; orderCount: number; childCount: number }>>;
  listBatches(): Promise<OperationResult<BatchSummary[]>>;
  listOrders(batchId: string | null): Promise<OperationResult<ProductionOrderRow[]>>;
  /** Linhas da planilha de importação do iApp para o lote; registra o momento da exportação. */
  exportIapp(batchId: string, actor: WriteActor): Promise<OperationResult<IappExport>>;
}
