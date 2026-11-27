import type { OperationResult } from '@/types/operations';
import type { OrderKind, OrderSuggestion } from '@/lib/pcp/op-generator';
import type { PlanLine } from '@/lib/pcp/sales-order-plan';
import type { SalesOrderHeader } from '@/server/integrations/bling-sales-orders';
import type { WriteActor } from './write-audit';

export type { OrderKind, OrderSuggestion, PlanLine };

export type PreviewInput = { kind: OrderKind; from: string; to: string; factor: number; policy?: 'bling' };
export type BlingQueueProgress = { stage: 'sales' | 'catalog' | 'stock' | 'sheets'; completed?: number; total?: number };
export type GenerationPreview = PreviewInput & {
  suggestions: OrderSuggestion[];
  /** Avisos que pedem atenção ou ação (dados atrasados, cadastro incompleto). */
  warnings: string[];
  /** Informações sem ação, mostradas só nos detalhes da tela (por exemplo, SKUs sem venda no período). */
  notes: string[];
  /** Quando o mín/máx foi copiado do Bling. */
  catalogSyncedAt: string;
  weeks?: number;
  invoiceCount?: number;
  categories?: string[];
  ignored?: { invoice: string; sku: string; quantity: number }[];
  previewToken?: string;
};

export type BatchItem = { sku: string; sheetId: string; quantity: number; description: string | null };
export type BatchInput = PreviewInput & { items: BatchItem[]; previewToken?: string; idempotencyKey?: string };

export type OrderStatus = 'a_produzir' | 'produzindo' | 'concluido' | 'suspenso' | 'encerrado';
/** Como a OP nasceu: fila de reposição, avulsa, pedido de venda do Bling ou carga do iApp. */
export type OrderOrigin = 'fila' | 'avulsa' | 'pedido' | 'iapp';
export type ProductionOrderRow = {
  id: string; number: number; kind: OrderKind; sku: string; description: string | null; sheetCode: string | null;
  quantity: number; status: OrderStatus; parentOrderId: string | null; batchId: string | null; createdAt: string; stepCount: number;
  origin: OrderOrigin; urgent: boolean; salesOrderNumber: string | null;
};
export type BatchSummary = {
  id: string; kind: OrderKind; createdAt: string; createdBy: string; exportedAt: string | null; orderCount: number; childCount: number;
  origin: Exclude<OrderOrigin, 'iapp'>; salesOrderNumber: string | null;
};

/** Produto que pode virar OP avulsa: tem ficha técnica com roteiro. */
export type ProducibleProduct = { sku: string; name: string; sheetId: string; sheetCode: string; stepCount: number; partCount: number };
export type ManualOrderInput = { kind: OrderKind; sku: string; sheetId: string; quantity: number; urgent: boolean; notes: string | null };
export type SalesOrderPreview = {
  /** O nome do cliente só aparece na tela; não é gravado. */
  order: SalesOrderHeader; lines: PlanLine[]; warnings: string[];
  /** OPs ainda não encerradas que já saíram deste pedido. */
  existing: { number: number; sku: string; kind: OrderKind; status: OrderStatus; createdAt: string }[];
};
export type SalesOrderBatchInput = {
  blingOrderId: number; urgent: boolean; confirmDuplicate: boolean;
  items: (BatchItem & { parts: BatchItem[] })[];
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
  preview(input: PreviewInput, actor: WriteActor | null, progress?: (step: BlingQueueProgress) => void): Promise<OperationResult<GenerationPreview>>;
  /** Copia do Bling o cadastro (mín/máx, formato) dos SKUs da linha oficial. Só lê o Bling. */
  syncBlingCatalog(actor: WriteActor): Promise<OperationResult<{ synced: number; missing: string[] }>>;
  createBatch(input: BatchInput, actor: WriteActor): Promise<OperationResult<{ batchId: string; orderCount: number; childCount: number }>>;
  listBatches(): Promise<OperationResult<BatchSummary[]>>;
  listOrders(batchId: string | null): Promise<OperationResult<ProductionOrderRow[]>>;
  /** Linhas da planilha de importação do iApp para o lote; registra o momento da exportação. */
  exportIapp(batchId: string, actor: WriteActor): Promise<OperationResult<IappExport>>;
  /** Produtos com ficha técnica com roteiro, para a OP avulsa. */
  listProducible(): Promise<OperationResult<ProducibleProduct[]>>;
  /** OP avulsa: uma OP do produto escolhido (no corte, com as OPs das partes), fora da fila de reposição. */
  createManualOrder(input: ManualOrderInput, actor: WriteActor): Promise<OperationResult<{ batchId: string; number: number; childCount: number }>>;
  /** Lê o pedido no Bling (só GET) e desdobra em OPs pela ficha técnica. */
  previewSalesOrder(number: string): Promise<OperationResult<SalesOrderPreview>>;
  /**
   * Grava as OPs do pedido: produto na produção semanal (dobra), partes no corte como OPs filhas. Relê o
   * pedido no Bling; recusa item ou parte fora do pedido e pede confirmação se o pedido já gerou OP.
   */
  createFromSalesOrder(input: SalesOrderBatchInput, actor: WriteActor): Promise<OperationResult<{ batchId: string; orderCount: number; childCount: number; salesOrderNumber: string }>>;
}
