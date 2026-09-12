
export interface Supply {
    id: string;
    nome: string;
    codigo: string;
    gtin: string;
    unidade: string;
    precoCusto: number;
    estoqueMinimo: number;
    estoqueMaximo: number;
    tempoEntrega: number; // em dias
    estoqueAtual: number; // Campo para o estoque atual
    createdAt?: string;
    updatedAt?: string;
}

/** Named inventory records may predate fields required by today's write form. */
export type SupplyRead = Pick<Supply, 'id' | 'nome'> & Partial<Omit<Supply, 'id' | 'nome'>>;
