
import type { Supply } from './supply';

export interface InventoryItem {
    supply: Supply;
    estoqueAtual: number;
    estoqueMinimo: number;
    valorEmEstoque: number;
    status: 'em_estoque' | 'baixo' | 'esgotado';
}
