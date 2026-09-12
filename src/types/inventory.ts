
import type { SupplyRead } from './supply';

export interface InventoryItem {
    supply: SupplyRead;
    estoqueAtual: number | null;
    estoqueMinimo: number | null;
    valorEmEstoque: number | null;
    status: 'em_estoque' | 'baixo' | 'esgotado' | 'desconhecido';
}


export interface InventoryMovement {
    id: string;
    supplyId: string;
    type: 'entrada' | 'saida';
    quantity: number;
    unitCost?: number; // Opcional, usado principalmente para entradas
    notes?: string;
    createdAt: string;
}
