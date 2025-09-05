
export interface Supply {
    id: string;
    produto: {
        id: string;
        nome: string;
    };
    estoqueMinimo: number;
    estoqueMaximo: number;
    tempoEntrega: number;
    custoUnitario: number;
    fornecedor: string;
}

    