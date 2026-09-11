import type { OperationSource } from './operations';
export interface ProductStock {
  produto: { id: number; codigo: string; nome: string };
  deposito: { id: number; nome: string };
  saldoFisico: number | null; saldoVirtual: number | null;
  saldoFisicoTotal: number | null; saldoVirtualTotal: number | null;
  stockMin?: number; stockMax?: number;
  source: OperationSource; asOf: string; physicalAsOf: string | null; virtualAsOf: string | null;
}
