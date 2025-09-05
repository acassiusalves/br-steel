
import type { Supply } from './supply';

export interface InventoryItem {
    supply: Supply;
    estoqueAtual: number;
    estoqueMinimo: number;
    valorEmEstoque: number;
    status: 'em_estoque' | 'baixo' | 'esgotado';
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
