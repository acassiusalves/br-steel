
// src/types/sale-order.ts

export interface SaleOrder {
  id: number;
  numero: number;
  numeroLoja: string;
  data: string;
  dataSaida: string;
  dataPrevista?: string;
  totalProdutos: number;
  total: number;
  contato: {
    id: number;
    nome: string;
    tipoPessoa?: 'F' | 'J';
    numeroDocumento?: string;
  };
  situacao: {
    id: number;
    valor: number;
    nome: string;
  };
  loja: {
    id: number;
    nome: string;
  };
  numeroPedidoCompra?: string;
  outrasDespesas?: number;
  observacoes?: string;
  observacoesInternas?: string;
  desconto?: {
    valor: number;
    unidade: 'REAL' | 'PERCENTUAL';
  };
  categoria?: {
    id: number;
  };
  notaFiscal?: {
    id: number;
  };
  tributacao?: {
    totalICMS: number;
    totalIPI: number;
  };
  itens: {
    id: number;
    codigo: string;
    unidade: string;
    quantidade: number;
    desconto: number;
    valor: number;
    aliquotaIPI: number;
    descricao: string;
    descricaoDetalhada: string;
    produto: {
      id: number;
    };
    comissao?: {
      base: number;
      aliquota: number;
      valor: number;
    };
  }[];
  parcelas?: {
    id: number;
    dataVencimento: string;
    valor: number;
    observacoes: string;
    formaPagamento: {
      id: number;
    };
  }[];
  transporte?: {
    fretePorConta: 0 | 1; // 0 = Emitente, 1 = Destinatário
    frete: number;
    quantidadeVolumes: number;
    pesoBruto: number;
    prazoEntrega: number;
    contato: {
      id: number;
      nome: string;
    };
    etiqueta: {
      nome: string;
      endereco: string;
      numero: string;
      complemento: string;
      municipio: string;
      uf: string;
      cep: string;
      bairro: string;
    };
    volumes: {
      id: number;
      servico: string;
      codigoRastreamento: string;
    }[];
  };
  vendedor: {
    id: number;
    nome: string;
  };
  intermediador?: {
    cnpj: string;
    nomeUsuario: string;
  };
  taxas?: {
    taxaComissao: number;
    custoFrete: number;
    valorBase: number;
  };
}
