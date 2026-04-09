
import { z } from 'zod';

export interface Cost {
  id: string;
  type: string;
  value: number;
  isPercentage: boolean;
}

export interface CompanyCost {
  id:string;
  description: string;
  value: number;
}

export interface Product {
  id: string;
  category: string;
  name: string;
  sku: string;
  attributes: Record<string, string>;
  createdAt: string;
  associatedSkus?: string[];
  associatedEans?: string[];
  averagePrice?: number;
  averagePriceUpdatedAt?: string;
  imageUrl?: string; // URL da imagem do produto (carregada dos pedidos)
  // Adicionado para busca de custos no ML
  fees?: {
    listing_fee_amount: MoneyLike;
    sale_fee_amount:   MoneyLike;
    sale_fee_percent:  MoneyLike;
    fee_total?:        MoneyLike;
    details?: {
      sale?: {
        gross_amount?:   MoneyLike;
        fixed_fee?:      MoneyLike;
        percentage_fee?: MoneyLike;
      };
      listing?: {
        fixed_fee?:      MoneyLike;
        gross_amount?:   MoneyLike;
      };
    };
  };
}

export interface InventoryItem {
  id: string;
  productId: string; // Links to the Product template
  name: string;      // The generated name from the Product, stored for convenience
  costPrice: number;
  serialNumber: string;
  sku: string;
  origin: string;
  quantity: number;
  createdAt: string; // ISO 8601 string date
  condition?: 'Novo' | 'Vitrine' | 'Usado' | 'Defeito' | 'Lacrado' | 'Seminovo';
  originalInventoryId?: string;
  orderNumber?: string;
  category?: 'Celular' | 'Geral';
  notes?: string; // Observações sobre o item (ex: detalhes de defeito)
  reason?: string; // Motivo do defeito/problema (ex: Tela, Placa, Bateria)
}

export interface EntryLog extends InventoryItem {
  originalInventoryId: string; // ID do item original na coleção inventory
  entryDate: string | Date; // Data de entrada no estoque
  logType: 'INVENTORY_ENTRY' | 'RETURN_ENTRY'; // Tipo de entrada
}

export type PickedItem = InventoryItem & { orderNumber: string; pickedAt: string };
export type PickedItemLog = PickedItem & { logId: string; };

// Tipos para rastreabilidade do produto (lifecycle tracking)
export interface ProductLifecycleEvent {
  type: 'entry' | 'in_stock' | 'pick' | 'return' | 'deletion' | 'correction';
  date: string;
  title: string;
  details: Record<string, any>;
}

export interface ProductLifecycle {
  serialNumber: string;
  sku: string;
  productName: string;
  events: ProductLifecycleEvent[];
  currentStatus: 'in_stock' | 'sold' | 'returned' | 'deleted';
}

export interface FullRemittanceLog {
    id: string;
    remittanceId: string; // ID for the entire batch
    productId: string;
    name: string;
    sku: string;
    eanOrCode: string;
    quantity: number;
    costPrice: number;
    remittedAt: string; // ISO Date
}

export interface StockCorrectionLog {
    id: string;
    inventoryItemId: string;
    productId: string;
    sku: string;
    eanOrCode?: string; // Código EAN ou código do produto (serialNumber do InventoryItem)
    productName: string;
    previousQuantity: number;
    newQuantity: number;
    difference: number; // newQuantity - previousQuantity (positive = added, negative = removed)
    costPrice: number; // Preço de custo unitário do produto
    reason: string;
    correctedBy: {
        uid: string;
        email: string;
        displayName: string | null;
    };
    correctedAt: string; // ISO Date
}

export interface StockDeletionLog {
    id: string;
    inventoryItemId: string;
    productId: string;
    productName: string;
    sku: string;
    serialNumber: string;
    costPrice: number;
    quantity: number;
    condition?: string;
    category?: 'Celular' | 'Geral';
    justification: string;
    deletedBy: {
        uid: string;
        email: string;
        displayName: string | null;
    };
    deletedAt: string; // ISO Date
}

// Snapshot diário do estoque para histórico
export interface StockSnapshotItem {
    sku: string;
    name: string;
    quantity: number;
    costPrice: number;             // preço unitário
    totalValue: number;            // quantity × costPrice
    category: string;              // 'celular' | 'geral'
    condition: string;             // 'Novo' | 'Usado' | etc
    location?: string;             // localização no estoque (serialNumber)
}

export interface StockSnapshot {
    id: string;                    // formato: YYYY-MM-DD
    date: string;                  // ISO Date (início do dia)
    totalQuantity: number;         // total de peças
    totalValue: number;            // valor total (custo)
    totalSkus: number;             // quantidade de SKUs diferentes
    byCategory: {
        celular: { quantity: number; value: number };
        geral: { quantity: number; value: number };
    };
    byCondition: Record<string, { quantity: number; value: number }>;
    items: StockSnapshotItem[];    // detalhes de cada SKU
    createdAt: string;             // quando o snapshot foi criado
}

// Snapshot diário do balanço patrimonial/inventário
export interface InventorySnapshotCustomField {
    id: string;
    name: string;
    value: number;
    category: 'ativo_circulante' | 'ativo_nao_circulante' | 'passivo' | 'patrimonio_liquido';
}

export interface InventorySnapshot {
    id: string;                    // formato: YYYY-MM-DD
    date: string;                  // ISO Date (início do dia)
    createdAt: string;             // quando o snapshot foi criado

    // Dados Automáticos
    dinheiroDisponivel: number;    // saldo total das contas bancárias
    dinheiroALiberar: number;      // total a liberar (MagaluPay + Mercado Pago)
    estoqueNovos: number;          // valor do estoque de produtos novos
    estoqueUsados: number;         // valor do estoque de produtos usados (com depreciação 80%)
    estoqueSeminovos: number;      // valor do estoque de produtos seminovos (com depreciação 50%)
    quantidadeNovos: number;       // quantidade de itens novos
    quantidadeUsados: number;      // quantidade de itens usados
    quantidadeSeminovos: number;   // quantidade de itens seminovos
    dividaAtiva: number;           // total de dívidas cadastradas

    // Dados Manuais
    capitalImobilizado: number;    // imóveis, veículos, equipamentos
    capitalDeTerceiros: number;    // empréstimos, financiamentos
    capitalSocial: number;         // capital investido pelos sócios

    // Campos Manuais Personalizados
    customFields: InventorySnapshotCustomField[];

    // Totais Calculados
    totalAtivoCirculante: number;
    totalAtivoNaoCirculante: number;
    totalAtivo: number;
    totalPassivo: number;
    totalPatrimonioLiquido: number;
    totalPassivoPatrimonio: number;

    // Indicadores
    indicadores: {
        liquidezCorrente: number;
        liquidezSeca: number;
        endividamento: number;
        capitalDeGiro: number;
        saudeFinanceira: number;
    };
}

export interface ReturnLog {
    id: string;
    productName: string;
    serialNumber: string;
    sku: string;
    orderNumber?: string;
    condition: string;
    reason?: string;
    notes?: string;
    returnedAt: string;
    quantity: number;
    originalSaleData?: PickedItemLog | null;
}

export interface ReturnReminder {
    id: string;
    orderCode: string;
    notes: string; // Até 150 caracteres
    reminderDate: string; // Data do lembrete
    createdAt: string;
    completed: boolean; // Se o lembrete já foi resolvido
    completedAt?: string;
}

export interface Debt {
    id: string;
    name: string;           // Nome/descrição da dívida
    value: number;          // Valor da dívida
    dueDate?: string;       // Data de vencimento (opcional)
    notes?: string;         // Observações (opcional)
    createdAt: string;
    updatedAt?: string;
}

export interface SACTicket {
    id: string;
    ticketNumber: string; // Número do chamado (gerado automaticamente)
    orderCode: string;
    orderNumber?: string; // Número do pedido original
    productName?: string; // Nome do produto
    customerName?: string; // Nome do cliente
    reason: 'Defeito' | 'Extravio' | 'Produto Diferente' | 'Apreensao';
    observations: string; // Até 1000 caracteres
    marketplaceTicketNumber?: string; // Número do chamado no marketplace (opcional)
    reminderDate: string; // Data do lembrete
    createdAt: string;
    status: 'open' | 'in_progress' | 'resolved' | 'closed';
    resolvedAt?: string;
    resolvedBy?: string;
}

export interface ProductAttribute {
    key: string;
    label: string;
    values: string[];
}

export interface ProductCategorySettings {
    id: string; // e.g., 'celular'
    name: string; // e.g., 'Celulares'
    attributes: ProductAttribute[];
}


export type AllMappingsState = { [key: string]: Partial<ColumnMapping> };

// Interface Sale com todos os campos possíveis para mapeamento
export interface Sale {
  // Core fields from user request
  id: string;
  productDescription: string;
  sku: string;
  orderNumber: string;
  cpf: string;
  salesChannel: string;
  account: string;
  status: string;
  saleDate: string;
  state: string;
  quantity: number;
  priceWithoutShipping: number;
  total: number; // Mapped to totalWithShipping or another field as needed
  totalWithShipping: number;
  commission: number;
  commissionPercentage: number;
  fee: number;
  shippingCost: number;
  tax: number;
  packaging: number;
  unitCost: number;
  totalCost: number;
  product_cost: number;
  profit: number;
  profitPercentage: number;
  netValue: number;
  refundedValue: number;
  productImage: string;
  paidAmount: number;
  discount: number;
  discountMarketplace: number;
  deliveryType: string;
  
  // Other potential fields from sheets/API
  friendlyName: string;
  statusDescription: string;
  verified: string;
  realStatus: string;
  returnStatus: string;
  verified2: string;
  ticket: string;
  resolved: string;
  notes: string;
  returnTracking: string;
  transferForecast: string;
  transferDate: string;
  editedLabel: string;
  deliveryTrackingCode: string; // added
  systemStatus?: 'Entregue' | 'Cancelado' | 'Devolução' | 'Devolução / Defeito' | 'Devolução / Seminovo' | 'Apreensão' | 'Em Transito' | 'Extravio' | null; // Status padronizado do sistema
  sent_date: string; // added
  customer_name: string; // added
  address_line: string; // added
  address_zip_code: string; // added
  address_district: string; // added
  address_city: string; // added

  // New fields from user request
  customerLastName?: string;
  customerNickname?: string;
  customerEmail?: string;
  documentType?: string;
  phoneAreaCode?: string;
  phoneNumber?: string;
  addressStreet?: string;
  addressNumber?: string;
  stateAbbreviation?: string;
  countryName?: string;
  addressComment?: string;
  addressReceiverName?: string;
  addressReceiverPhone?: string;

  // App-specific fields
  costs: Cost[];
  grossRevenue: number;
  sheetData?: Record<string, any>; // DEPRECATED: Mantido para compatibilidade, use customFields
  customData?: Record<string, number>;
  mlData?: Record<string, any>; // Dados do Mercado Livre
  magaluData?: Record<string, any>; // Dados do Magalu
  blingData?: Record<string, any>; // Dados do Bling ERP
  seized?: boolean; // Pedido apreendido por órgão de fiscalização
  seizedDate?: string; // Data da apreensão
  seizedNotes?: string; // Observações sobre a apreensão
  reconciled?: boolean; // Pedido foi conciliado/verificado pelo usuário
  reconciledAt?: string; // Data/hora da conciliação
  reconciledBy?: string; // Usuário que conciliou

  // Novo sistema de campos personalizados (substituindo sheetData)
  customFields?: Record<string, {
    value: any;
    fromSheet: boolean;
    sheetColumn: string;
    importedAt: string;
  }>;

  // Campos unificados do sistema (podem vir de planilhas ou cálculos)
  systemDiscount?: number; // Desconto unificado (substitui desconto específico de marketplace)
  systemChargeback?: number; // Estorno unificado (chargebacks, devoluções parciais)

  // Metadata de importação de planilhas
  sheetImportMetadata?: {
    importId: string; // ID da importação que criou/modificou este registro
    importedAt: string;
    fileName: string;
    fieldsFromSheet: string[]; // Lista de campos que vieram da planilha
    migratedFrom?: 'legacy'; // Indica se foi migrado do formato antigo
  };
}

// This mapping now covers all possible fields user might want to map
export interface ColumnMapping {
    id?: string;
    productName?: string;
    sku?: string;
    orderNumber?: string;
    cpf?: string;
    salesChannel?: string;
    account?: string;
    status?: string;
    saleDate?: string;
    state?: string;
    quantity?: string;
    priceWithoutShipping?: string;
    total?: string;
    totalWithShipping?: string;
    commission?: string;
    commissionPercentage?: string;
    fee?: string;
    shippingCost?: string;
    tax?: string;
    packaging?: string;
    unitCost?: string;
    totalCost?: string;
    product_cost?: string;
    profit?: string;
    profitPercentage?: string;
    netValue?: string;
    refundedValue?: string;
    productImage?: string;
    paidAmount?: string;
    discount?: string;
    discountMarketplace?: string;
    deliveryType?: string;
    friendlyName?: string;
    statusDescription?: string;
    verified?: string;
    realStatus?: string;
    returnStatus?: string;
    verified2?: string;
    ticket?: string;
    resolved?: string;
    notes?: string;
    returnTracking?: string;
    transferForecast?: string;
    transferDate?: string;
    editedLabel?: string;

    // New fields from user request
    customerLastName?: string;
    customerNickname?: string;
    customerEmail?: string;
    documentType?: string;
    phoneAreaCode?: string;
    phoneNumber?: string;
    addressStreet?: string;
    addressNumber?: string;
    stateAbbreviation?: string;
    countryName?: string;
    addressComment?: string;
    addressReceiverName?: string;
    addressReceiverPhone?: string;
}

// Type for the AI's direct output
export interface SuggestMappingOutput {
  reasoning: string;
}

export interface SuggestionRequest {
  headersForAI: string[]; // Labels for Ideris, headers for CSV
  allSourceHeaders: string[]; // Keys for Ideris, headers for CSV
  isIderis: boolean;
}

export interface AppUser {
  id: string; // UID from Firebase Auth
  email: string;
  role: string;
  mustChangePassword?: boolean; // Flag para forcar troca de senha
  passwordChangedAt?: string;   // Data/hora da ultima troca de senha (ISO string)

  // Campos de rastreamento de acesso
  lastActivityAt?: string;      // Última atividade no sistema
  lastLoginAt?: string;         // Último login
  loginCount?: number;          // Total de logins
  avgSessionDuration?: number;  // Duração média de sessão em minutos
  knownDevices?: string[];      // Lista de fingerprints de dispositivos conhecidos
  knownLocations?: string[];    // Lista de localizações conhecidas ("cidade, país")
  passwordHistory?: string[];   // Histórico de timestamps de mudanças de senha
  currentSessionId?: string;    // ID da sessão atual (se ativo)

  // Campos de verificação de identidade
  requiresVerification?: boolean;  // Admin forçou verificação de identidade
  lastVerificationAt?: string;     // Última verificação bem-sucedida
  verificationCount?: number;      // Total de verificações
}

export type ApiKeyStatus = "unchecked" | "valid" | "invalid";

// -- Support Data Types --
export interface SupportFile {
    id: string; // Unique ID for each file upload instance
    channelId: string; // e.g., 'magalu'
    fileName: string;
    fileContent: string; // The raw file content (CSV or stringified JSON)
    headers: string[];
    friendlyNames: Record<string, string>;
    associationKey: string;
    uploadedAt: string; // ISO 8601 string for the upload date
}

export interface SupportData {
    // Files are now an array per channel
    files: Record<string, SupportFile[]>; // Keyed by channelId
}

// -- Custom Calculation Types --
export type FormulaItem = { type: 'column' | 'operator' | 'number'; value: string; label: string };

export interface ConditionalFormula {
    statuses: string[]; // Status do Sistema que ativam esta fórmula
    marketplaces?: string[]; // Canais (Marketplaces) que ativam esta fórmula
    formula: FormulaItem[];
}

export interface CustomCalculation {
    id: string;
    name: string;
    formula: FormulaItem[]; // Fórmula padrão (usada quando não há condicionais ou quando o status não corresponde)
    conditionalFormulas?: ConditionalFormula[]; // Fórmulas condicionais baseadas em Status do Sistema
    isPercentage?: boolean;
    targetMarketplace?: string;
    targetDeliveryStatus?: string[]; // Array de status de entrega que esta equação deve considerar
    interaction?: {
        targetColumn: string;
        operator: '+' | '-';
    };
    ignoreIfCancelled?: boolean;
}

// -- Approval Request Types --
export interface ApprovalRequest {
    id: string;
    type: 'SKU_MISMATCH_PICKING';
    status: 'pending' | 'approved' | 'rejected';
    requestedBy: string; // User's email
    createdAt: string; // ISO Date
    orderData: Sale;
    scannedItem: InventoryItem;
    processedItem?: InventoryItem;
    processedBy?: string; // User's email
    processedAt?: string; // ISO Date
}

// -- Notification Types --
export interface StockNotification {
    id: string;
    type: 'OUT_OF_STOCK';
    itemId: string; // ID do anúncio do Mercado Livre
    itemTitle: string;
    itemThumbnail: string;
    accountId: string;
    accountName: string;
    sku?: string;
    catalogProductId?: string;
    createdAt: string; // ISO Date
    read: boolean;
}

// -- Notice Types --
export interface Notice {
  id: string;
  title: string;
  message: string;
  type: 'info' | 'warning' | 'success' | 'destructive';
  startDate: string; // ISO Date string
  endDate: string;   // ISO Date string
  targetRoles: ('financeiro' | 'expedicao' | 'sac' | 'admin' | 'socio')[];
  targetPages?: string[]; // Array of page paths like '/estoque'
  isActive: boolean;
  createdAt: string; // ISO Date
  createdBy: string; // User's email
}

export interface PickingNotice {
  id: string;
  targetStates: string[];
  message: string;
  type: 'info' | 'warning' | 'destructive';
  showOnce: boolean;
  timesShown: number;
  isActive: boolean;
  createdBy: string;
  createdAt: string;
}


export interface MercadoLivreCredentials {
  appId?: string; // Antigo nome do campo
  clientId?: string; // Nome correto usado no Firestore
  clientSecret: string;
  redirectUri?: string;
  refreshToken: string;
  accessToken?: string;
  apiStatus?: ApiKeyStatus;
  nickname?: string;
  id_conta_autenticada?: string;
  userId?: number | string;
  accountName?: string;
  sellerId?: number;
  status?: string;
}

export interface MagaluCredentials {
  id?: string;
  nome_conta?: string;
  accountName?: string; // Alias para nome_conta
  uuid: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  accessToken?: string;
  apiStatus?: ApiKeyStatus;
}

// -- Bling ERP Types --
export interface BlingCredentials {
  id: string;
  clientId: string;
  clientSecret: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // Timestamp de expiração do access token
  accountName?: string;
  apiStatus?: ApiKeyStatus;
  createdAt?: string;
  updatedAt?: string;
}

export interface BlingContato {
  id: number;
  nome: string;
  tipoPessoa: 'F' | 'J' | 'E'; // Física, Jurídica, Estrangeiro
  numeroDocumento: string;
  email?: string;
  telefone?: string;
  celular?: string;
  endereco?: {
    endereco: string;
    numero: string;
    complemento?: string;
    bairro: string;
    cidade: string;
    uf: string;
    cep: string;
  };
}

export interface BlingPedidoItem {
  id: number;
  codigo: string; // SKU
  descricao: string;
  unidade: string;
  quantidade: number;
  valor: number; // Valor unitário
  desconto: number;
  aliquotaIPI?: number;
  produto?: {
    id: number;
  };
}

export interface BlingParcela {
  id: number;
  dataVencimento: string;
  valor: number;
  formaPagamento?: {
    id: number;
    descricao?: string;
  };
  observacoes?: string;
}

export interface BlingTransporte {
  fretePorConta: number; // 0=Emitente, 1=Destinatário, 2=Terceiros, 9=Sem frete
  transportadora?: {
    id: number;
    nome?: string;
  };
  volumes?: number;
  pesoBruto?: number;
  prazoEntrega?: number;
  contato?: BlingContato;
  etiqueta?: {
    nome?: string;
    endereco?: string;
    numero?: string;
    complemento?: string;
    municipio?: string;
    uf?: string;
    cep?: string;
    bairro?: string;
  };
}

export interface BlingPedido {
  id: number;
  numero: string;
  numeroLoja?: string;
  data: string; // YYYY-MM-DD
  dataSaida?: string;
  dataPrevista?: string;
  situacao: {
    id: number;
    valor: string;
  };
  contato: BlingContato;
  itens: BlingPedidoItem[];
  parcelas: BlingParcela[];
  transporte: BlingTransporte;
  loja?: {
    id: number;
  };
  numeroPedidoCompra?: string;
  outrasDespesas: number;
  observacoes?: string;
  observacoesInternas?: string;
  desconto: {
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
    totalICMS?: number;
    totalIPI?: number;
  };
  // Campos calculados
  totalProdutos: number;
  totalDescontos: number;
  frete: number;
  total: number;
}

export interface BlingPedidoListItem {
  id: number;
  numero: string;
  numeroLoja?: string;
  data: string;
  dataSaida?: string;
  dataPrevista?: string;
  totalProdutos: number;
  total: number;
  contato: {
    id: number;
    nome: string;
    tipoPessoa: string;
    numeroDocumento: string;
  };
  situacao: {
    id: number;
    valor: string;
  };
  loja?: {
    id: number;
  };
}

/**
 * Payload do webhook do Bling (formato oficial conforme documentação)
 * @see https://developer.bling.com.br/webhooks#recursos
 *
 * Eventos de pedido de venda:
 * - pedido_venda.created: Novo pedido de venda criado
 * - pedido_venda.updated: Pedido de venda alterado
 * - pedido_venda.deleted: Pedido de venda excluído
 */
export interface BlingWebhookPayload {
  eventId: string;        // ID único do evento
  date: string;           // Data/hora do evento (ISO 8601)
  version: string;        // Versão do evento
  event: string;          // Tipo do evento: 'pedido_venda.created' | 'pedido_venda.updated' | etc
  companyId: number;      // ID da empresa no Bling
  data: {
    id: number;           // ID do recurso (pedido, nota, etc)
  };
}

/**
 * @deprecated Use BlingWebhookPayload com os campos corretos
 * Mantido para compatibilidade temporária
 */
export interface BlingWebhookPayloadLegacy {
  evento: string;
  dados: {
    id: number;
    numero?: string;
  };
}

/**
 * Pedido do Bling armazenado na coleção de staging
 * Path: users/{userId}/bling-pedidos/{blingPedidoId}
 */
export interface BlingPedidoStaging {
  // Identificadores
  id: number;                    // ID do pedido no Bling
  numero: string;                // Número do pedido
  numeroLoja?: string;           // Número do pedido na loja/marketplace

  // Dados brutos do Bling
  rawData: BlingPedido;          // Objeto completo da API

  // Status de processamento
  status: 'pending' | 'processing' | 'migrated' | 'failed';

  // Metadados de migração
  migration?: {
    migratedAt?: string;         // Data da migração para sales
    saleId?: string;             // ID gerado na collection sales
    error?: string;              // Erro se falhou
  };

  // Metadados de importação
  importedAt: string;            // Data de importação do Bling
  importSource: 'api' | 'webhook';
  updatedAt: string;             // Última atualização
  pedidoData?: string;           // Data do pedido (para ordenação)
}

export interface MlAccount {
    id: string; // Document ID from Firestore
    nickname?: string;
    accountName?: string;
    appId: string;
    clientSecret: string;
    refreshToken: string;
    redirectUri: string;
    apiStatus?: ApiKeyStatus;
    id_conta_autenticada?: string; 
    userId?: number;
}


// -- App Settings --
export interface AppSettings {
    iderisPrivateKey?: string;
    googleSheetsApiKey?: string;
    geminiApiKey?: string;
    openaiApiKey?: string; // New field for OpenAI
    mercadoLivre?: MercadoLivreCredentials;
    mercadoLivre2?: MercadoLivreCredentials;
    magalu?: MagaluCredentials;
    allMappings?: AllMappingsState;
    friendlyFieldNames?: Record<string, string>;
    fileNames?: { [key: string]: string };
    fileData?: { [key: string]: string };
    iderisApiStatus?: ApiKeyStatus;
    googleSheetsApiStatus?: ApiKeyStatus;
    geminiApiStatus?: ApiKeyStatus;
    openaiApiStatus?: ApiKeyStatus; // New field for OpenAI status
    permissions?: Record<string, string[]>;
    inactivePages?: string[];
    customCalculations?: any[];
    ignoredIderisColumns?: string[];
    conciliacaoColumnOrder?: string[];
    conciliacaoVisibleColumns?: Record<string, boolean>;
    stores?: string[];
    organizePrompt?: string;
    standardizePrompt?: string;
    lookupPrompt?: string;
    favoriteCategories?: MLCategory[];
    gordura_variable?: number;
    summaryConfig?: SummaryConfig;
}

// -- Purchase History Types --
export interface PurchaseListItem {
    productName: string;
    sku: string;
    quantity: number;
    unitCost: number;
    storeName: string;
    isPaid?: boolean;
    surplus?: number;
    isManual?: boolean;
}

export interface PurchaseList {
    id: string;
    createdAt: string; // ISO Date
    totalCost: number;
    items: PurchaseListItem[];
    totalEntradas?: number; // Adicionando o campo para o total de entradas
}

// Feed 25 Types
export interface ProductDetail {
  name: string;
  sku: string;
  quantity?: string; // Tornar opcional
  unitPrice?: string; // Tornar opcional
  totalPrice?: string; // Tornar opcional
  costPrice?: string; // Adicionar novo campo
  _normalizedModel?: string; // Para debug: mostrar modelo normalizado
  _score?: number; // Para debug: mostrar score do match
}

export interface FeedEntry {
    storeName: string;
    date: string;
    products: ProductDetail[];
    id: string;
}

export interface UnprocessedItem {
  line: string;
  reason: string;
}

export interface OrganizeResult {
  organizedList: string[];
}

export interface StandardizeListOutput {
  standardizedList: string[];
  unprocessedItems: UnprocessedItem[];
}

const ProductDetailSchema = z.object({
  name: z.string(),
  sku: z.string(),
  costPrice: z.string(),
});

export const LookupResultSchema = z.object({
  details: z.array(ProductDetailSchema),
});
export type LookupResult = z.infer<typeof LookupResultSchema>;

export const LookupProductsInputSchema = z.object({
  productList: z.string().describe('The standardized, line-by-line list of products.'),
  databaseList: z.string().describe('The product database as a string, with "Name\\tSKU" per line.'),
  apiKey: z.string().optional(),
  prompt_override: z.string().optional(),
});
export type LookupProductsInput = z.infer<typeof LookupProductsInputSchema>;


export interface PipelineResult {
  organizedList: string;
  standardizedList: string;
  details: ProductDetail[];
  finalFormattedList: string;
  unprocessedItems: UnprocessedItem[];
}

// Conference History
export interface ConferenceResult {
  found: InventoryItem[];
  notFound: string[];
  notScanned: InventoryItem[];
}

export interface ConferenceHistoryEntry {
    id: string;
    date: string;
    results: ConferenceResult;
}

export type AnalyzeLabelOutput = {
  recipientName: string;
  streetAddress: string;
  city: string;
  state: string;
  zipCode: string;
  orderNumber: string;
  invoiceNumber: string;
  trackingNumber: string;
  senderName: string;
  senderAddress: string;
  estimatedDeliveryDate?: string;
  senderNeighborhood?: string;
  senderCityState?: string;
};

// Tipos de campos que podem ser remixados pela IA
export type RemixableField =
  | 'orderNumber'
  | 'invoiceNumber'
  | 'trackingNumber'
  | 'senderName'
  | 'senderAddress'
  | 'senderAddressComplement'
  | 'recipientName'
  | 'streetAddress'
  | 'city'
  | 'state'
  | 'zipCode';

export type RemixLabelDataInput = {
    fieldToRemix: RemixableField;
    originalValue: string;
    apiKey?: string;
};

export type RemixLabelDataOutput = {
    newValue: string;
};

// Label Model Types
export interface LabelFieldMapping {
  x: number;
  y: number;
  label: string;
  tolX?: number;
  tolY?: number;
}

export interface LabelModel {
  id: string;
  name: string;
  description?: string;
  fieldMappings: Record<string, LabelFieldMapping>; // key is the fieldType
  isActive: boolean;
  createdAt: string;
  isCustom?: boolean; // true se foi criado pelo usuário
  createdBy?: string; // email do usuário que criou
}

export interface PrintedLabel {
  id: string; // orderId or orderCode
  zplContent: string;
  modelId?: string; // ID of the label model used
  createdAt: string;
}

// Catalog Analysis Types
export const AnalyzeCatalogInputSchema = z.object({
  pdfContent: z.string().describe('The full text content extracted from a single PDF page.'),
  pageNumber: z.number().describe('The current page number being analyzed.'),
  totalPages: z.number().describe('The total number of pages in the PDF.'),
  brand: z.string().optional().describe('The brand of the products in the catalog.'),
  apiKey: z.string().optional().describe('The Gemini API key.'),
});
export type AnalyzeCatalogInput = z.infer<typeof AnalyzeCatalogInputSchema>;

export const CatalogProductSchema = z.object({
  name: z.string().describe('The full name of the product.'),
  model: z.string().describe('The specific model of the product (e.g., "Note 13 Pro", "Galaxy S24 Ultra").'),
  brand: z.string().describe('The brand of the product.'),
  description: z.string().describe('A brief description of the product, including details like color, memory, etc.'),
  price: z.string().describe('The price of the product, formatted as a string with a dot as decimal separator (e.g., "22.35").'),
  imageUrl: z.string().optional().describe('A placeholder image URL for the product.'),
  quantityPerBox: z.number().optional().describe('The number of units per box, if mentioned.'),
});

export const AnalyzeCatalogOutputSchema = z.object({
  products: z.array(CatalogProductSchema.extend({
    isTrending: z.boolean().optional(),
    matchedKeywords: z.array(z.string()).optional(),
  })).describe('A list of products extracted from the page.'),
});
export type AnalyzeCatalogOutput = z.infer<typeof AnalyzeCatalogOutputSchema>;

export interface CatalogProduct extends z.infer<typeof CatalogProductSchema> {}
export interface SearchableProduct extends CatalogProduct {
    refinedQuery?: string;
    isSearching?: boolean;
    searchError?: string;
    foundProducts?: any[];
    isTrending?: boolean;
    matchedKeywords?: string[];
}


// Refine Search Term Types
export const RefineSearchTermInputSchema = z.object({
  productName: z.string().describe('The full, original name of the product.'),
  productModel: z.string().optional().describe('The specific model of the product.'),
  productBrand: z.string().optional().describe('The brand of the product.'),
});
export type RefineSearchTermInput = z.infer<typeof RefineSearchTermInputSchema>;

export const RefineSearchTermOutputSchema = z.object({
  refinedQuery: z.string().describe('The optimized search term for Mercado Livre, containing only essential keywords.'),
});
export type RefineSearchTermOutput = z.infer<typeof RefineSearchTermOutputSchema>;


export interface MLCategory {
  id: string;
  name: string;
}

export interface Trend {
    keyword: string;
    embedding?: number[];
}

export interface BestSellerItem {
  id: string;
  position: number | null;
  title: string;
  price: number;
  thumbnail: string | null;
  permalink: string | null;
  model?: string;
}

export interface MlAnalysisResult {
    category: MLCategory;
    trends: Trend[];
    bestsellers: BestSellerItem[];
}

export interface SavedMlAnalysis {
  id: string;
  createdAt: string; // ISO date
  mainCategoryName: string;
  mainCategoryId: string;
  results: MlAnalysisResult[];
}

// Mercado Livre Shipping Type
export interface Shipping {
    mode?: string;
    methods?: any[];
    tags?: string[];
    dimensions?: {
        height?: string;
        width?: string;
        length?: string;
        weight?: string;
    } | null;
    local_pick_up?: boolean;
    free_shipping?: boolean;
    logistic_type?: string;
}

// Mercado Livre My Items Type
export interface MyItem {
    id: string;
    title: string;
    price: number;
    status: string;
    permalink: string;
    thumbnail: string;
    catalog_product_id?: string | null;
    currency_id: string;
    sale_terms: any[];
    warranty: string;
    accepts_mercadopago: boolean;
    available_quantity: number;
    sold_quantity: number;
    shipping: Shipping;
    category_id: string;
    pictures: { url: string; secure_url: string }[];
    seller_custom_field: string | null;
    attributes: { id: string; value_name: string | null; name: string }[];
    variations: {
        id: number;
        price: number;
        available_quantity: number;
        sold_quantity: number;
        seller_custom_field: string | null;
        attribute_combinations: { id: string; name: string; value_id: string | null; value_name: string }[];
        attributes: { id: string; value_name: string | null; name: string }[];
        picture_ids: string[];
    }[];
    accountId: string;
    savedAt?: string;
    marketplace?: string;
    // Adicionando os novos campos da coleção 'anuncios'
    data_sync?: string;
    id_conta_autenticada?: string;
    id_produto?: string;
    initial_quantity?: number;
    last_updated?: string;
    listing_type_id?: string;
    precificacao_automatica?: boolean;
    seller_id?: number;
    deliveryType?: string;
    start_time?: string;
    shipping_tags?: string[];

    // === Campos de Desempenho e Métricas ===
    health?: number;  // Score 0-1
    official_store_id?: string | null;
    catalog_listing?: boolean;

    // === Campos de Visibilidade ===
    automatic_relist?: boolean;
    date_created?: string;  // ISO date
    stop_time?: string;  // ISO date

    // === Campos de Vendas ===
    buying_mode?: string;  // "buy_it_now" | "auction"
    condition?: string;  // "new" | "used" | "refurbished"
    video_id?: string | null;

    // === Campos de Precificação ===
    base_price?: number;
    original_price?: number;
    deal_ids?: string[];
}


// Mercado Livre Cost Calculation Types
export interface SaleCost {
    listing_type_id: string;
    listing_type_name: string;
    price: number;
    sale_fee_rate: number;
    sale_fee: number;
    fixed_fee: number;
    shipping_cost: number;
    net_amount: number;
}

export interface SaleCosts {
    id: string;
    title: string;
    category_id: string;
    costs: SaleCost[];
}

export type MoneyLike = string | number | null | undefined;

export interface PostedOnAccount {
    accountId: string;
    accountName: string;
    listingTypeId: string;
}

interface FeeDetails {
    listing_fee_amount: number;
    sale_fee_amount: number;
    sale_fee_percent: number;
    fixed_fee: number;
    fee_total?: number;
    shipping_cost: number;
}


export interface ProductResult {
    id: string;
    thumbnail: string;
    name: string;
    catalog_product_id: string;
    brand: string;
    model: string;
    price: number; // This can be the 'winner' price for general reference
    classicPrice: number | null; // Lowest price for gold_special
    premiumPrice: number | null; // Lowest price for gold_pro
    classicFees: FeeDetails | null;
    premiumFees: FeeDetails | null;
    shipping_logistic_type: string;
    category_id: string;
    seller_nickname: string;
    is_official_store: boolean;
    offerCount: number;
    attributes: { id: string, name: string, value_name: string | null }[];
    reputation?: {
        level_id: string | null;
        power_seller_status: string | null;
        metrics: {
            claims_rate: number;
            cancellations_rate: number;
            delayed_rate: number;
        }
    }
    seller_state?: string | null;
    seller_city?: string | null;
    date_created?: string | null;
    rating_average?: number;
    reviews_count?: number;
    postedOnAccounts?: PostedOnAccount[];
    originalProductPrice: string; // from the PDF catalog
    raw_data?: any;
    // Dados de enriquecimento (Fase 2)
    totalVisits?: number; // Total de visitas do item winner
    stockRange?: { min: number; max: number; label: string }; // Faixa de estoque
    stockLevel?: 'none' | 'low' | 'medium' | 'high' | 'very_high'; // Nível de estoque
    competitorCount?: number; // Quantidade de vendedores competindo
    priceRange?: { min: number; max: number; avg: number }; // Range de preços da competição
    // Histórico de preços (últimos 30 dias)
    priceHistory?: PriceHistoryEntry[];
}

/**
 * Entrada de histórico de preço de um produto
 */
export interface PriceHistoryEntry {
    date: string; // YYYY-MM-DD
    classicPrice: number | null;
    premiumPrice: number | null;
    minPrice: number | null;
    maxPrice: number | null;
    avgPrice: number | null;
}

export type FullFlowResult = {
    organizar: string;
    padronizar: string;
    lookup: string;
};


export interface CreateListingPayload {
  site_id: 'MLB';
  title?: string;
  category_id: string;
  price: number;
  currency_id: 'BRL';
  available_quantity: number;
  buying_mode: 'buy_it_now';
  listing_type_id: string;
  condition: 'new' | 'used' | 'not_specified';
  sale_terms: { id: string; value_name: string; }[];
  pictures: any[];
  attributes: {
    id: string;
    name?: string;
    value_id?: string;
    value_name: string;
    value_struct?: any;
    attribute_group_id?: string;
    attribute_group_name?: string;
  }[];
  catalog_product_id: string;
  catalog_listing: boolean;
  shipping?: any;
}


export interface CreateListingResult {
    success: boolean;
    error: string | null;
    result: any | null; // A resposta da API, seja de sucesso ou erro.
    payload?: CreateListingPayload;
}

export interface SuccessfulListing {
    productResultId: string;
    accountId: string;
    listingTypeId: string;
}


export interface SavedPdfAnalysis {
    id: string;
    createdAt: string; // ISO date
    analysisName: string;
    brand: string;
    extractedProducts: SearchableProduct[];
    batchSearchResults: ProductResult[];
}

export interface Timestamp {
  seconds: number;
  nanoseconds: number;
}
    
// -- Pedidos Magalu --
export interface MagaluOrder {
  id: string;
  code: string;
  status: string;
  created_at: string;
  approved_at?: string;
  purchased_at: string;
  updated_at: string;
  
  channel: {
    id?: string;
    marketplace: { document: string };
    extras: { alias: string };
  };
  
  customer: {
    name: string;
    document_number: string;
    customer_type: string;
    birth_date?: string;
  };
  
  payments: [{
    description: string;
    method: string;
    method_brand: string;
    installments: number;
    authorization_code: string;
    amount: number;
  }];
  
  amounts: {
    currency: string;
    normalizer: number;
    total: number;
    discount: { value?: number; currency: string; normalizer: number };
    freight: { value?: number; currency: string; normalizer: number };
    tax: { value?: number; currency: string; normalizer: number };
    commission: { type?: string; value?: number; total?: number; currency: string; normalizer: number };
  };
  
  deliveries: [{
    code: string;
    id: string;
    status: string;
    seller: { id: string; name: string };
    items: [{
      sequencial: number;
      quantity: number;
      measure_unit: string;
      unit_price: { value?: number; currency: string; normalizer: number };
      info: {
        sku: string;
        id: string;
        name: string;
        description?: string;
        images: [{ url: string }];
        dimensions?: {
          height: { value: number; unit: string };
          width: { value: number; unit: string };
          length: { value: number; unit: string };
          weight: { value: number; unit: string };
        };
      };
      amounts: {
        currency: string;
        normalizer: number;
        total: number;
        discount: { value?: number };
        freight: { value?: number };
        commission: { value?: number; total?: number };
      };
    }];
    shipping: {
      recipient: {
        name: string;
        document_number: string;
        address: {
          zipcode: string;
          street: string;
          number: string;
          district: string;
          city: string;
          state: string;
          country: string;
          complement?: string;
          reference?: string;
        };
      };
      provider: {
        id: string;
        name: string;
        description: string;
        extras: {
          shipping_type?: string;
          shipping_name?: string;
        };
      };
      tracking_url?: string;
      handling_time: {
        value: number;
        precision: string;
        limit_date: string;
      };
      deadline: {
        value: number;
        precision: string;
        limit_date: string;
      };
    };
  }];
  
  magaluAccountId: string;
  data_importacao: Timestamp;
}

export interface DeliveryHistory {
  deliveryId: string;
  orderId: string;
  history: [{
    status?: string;
    description?: string;
    timestamp?: string;
    location?: string;
  }];
  lastUpdated: Timestamp;
}

// Fluxo de Caixa - Previsões de Recebíveis
export interface CashFlowForecast {
  id?: string;
  date: string; // YYYY-MM-DD
  marketplace: string; // "Mercado Livre", "Magazine Luiza", "Americanas", "Amazon"
  account: string; // Nome da conta vendedora
  amount: number;
  received?: boolean; // Se o pagamento já foi recebido na conta bancária
  receivedAt?: string; // Data/hora em que foi marcado como recebido
  receivedTo?: string; // Conta bancária destino do pagamento
  createdAt?: string;
  updatedAt?: string;
}

export interface BankAccount {
  id?: string;
  bank: string; // Nome do banco (MagaluPay, Mercado Pago)
  account: string; // Nome da conta
  name: string; // Nome completo (banco - conta)
  balance: number;
  updatedAt?: string;
}

export interface BankAccountHistory {
  id?: string;
  bankAccountId: string;
  bankAccountName: string;
  balance: number;
  date: string; // YYYY-MM-DD - data do snapshot
  createdAt?: string;
}

export interface AccountDetail {
  id?: string;
  bank: string; // MagaluPay ou Mercado Pago
  account: string; // Nome da conta
  date: string; // YYYY-MM-DD
  // Campos comuns
  magalupay?: number; // Total no MagaluPay (apenas para Magalu)
  totalALiberar?: number; // Total a liberar
  disponivel?: number; // Disponível
  bloqueado?: number; // Bloqueado
  antecipacao?: number; // Antecipação
  repasse?: number; // Repasse
  rep29_8?: number; // Rep. 29/8
  repDiario?: number; // Rep. Diário
  valorCreditado?: number; // Valor Creditado
  // Campos específicos Mercado Pago
  aLiberar?: number; // A liberar
  retido?: number; // Retido
  dipsAnteci?: number; // Dips. Anteci.
  repasseDoDia?: number; // Repasse do dia
  createdAt?: string;
  updatedAt?: string;
}

// Histórico de importações de planilhas
export interface ImportLog {
  id: string; // UUID da importação
  userId: string;
  importedAt: string;
  fileName: string;
  fileSize: number;

  // Estatísticas
  stats: {
    totalRows: number;
    newSales: number; // Pedidos novos adicionados
    updatedSales: number; // Pedidos que foram atualizados
    skippedSales: number; // Pedidos que foram pulados (duplicados)
    errorRows: number; // Linhas com erro
  };

  // Detalhes da importação
  columns: string[]; // Colunas detectadas na planilha
  mappedFields: Record<string, string>; // Mapeamento usado (coluna → campo)

  // IDs dos pedidos afetados
  affectedSaleIds: string[]; // IDs de todas as vendas criadas/modificadas

  // Backup dos dados anteriores (para rollback)
  backup?: {
    [saleId: string]: Partial<Sale>; // Estado anterior das vendas
  };

  // Status
  status: 'completed' | 'partial' | 'failed';

  // Rollback
  rolledBack?: boolean;
  rolledBackAt?: string;
  rolledBackBy?: string;
}

// Campos do sistema promovidos de customFields
export interface SystemField {
  id: string; // Key do campo (ex: 'taxaMaquininha')
  label: string; // Nome amigável (ex: 'Taxa da Maquininha')
  type: 'text' | 'number' | 'currency' | 'percentage' | 'date';
  group: 'Sistema';
  isPromoted: boolean; // true se foi promovido de customField
  promotedAt?: string;
  promotedBy?: string; // userId
  usageCount: number; // Quantos pedidos usam este campo

  // Mapeamento de nomes de colunas de planilha
  sheetColumnAliases: string[]; // Variações do nome aceitas na importação

  // Metadata
  createdAt: string;
  updatedAt?: string;
}

// ============================================
// AGRUPAMENTO DE ANÚNCIOS MERCADO LIVRE
// ============================================

/**
 * Estatísticas de preço de um grupo de anúncios
 */
export interface PriceStats {
  min: number;
  max: number;
  average: number;
}

/**
 * Estatísticas de margem de um grupo de anúncios
 */
export interface MarginStats {
  min: number;
  max: number;
  average: number;
}

/**
 * Grupo de anúncios agrupados por SKU
 * Representa múltiplos anúncios do Mercado Livre para o mesmo produto
 */
export interface AnnouncementGroup {
  /** SKU pai do grupo (identificador principal do produto) */
  parentSku: string;
  /** Nome do produto */
  productName: string;
  /** URL da thumbnail do produto */
  thumbnail?: string;
  /** Lista de anúncios do grupo */
  announcements: MyItem[];
  /** Total de anúncios no grupo */
  totalAnnouncements: number;
  /** Estatísticas de preço (min/max/média) */
  priceStats: PriceStats;
  /** Estatísticas de margem (opcional, requer cálculo de custos) */
  marginStats?: MarginStats;
  /** Estoque total no sistema interno (inventário) */
  systemStock: number;
  /** Soma do available_quantity de todos os anúncios ML */
  mlTotalStock: number;
  /** Lista de IDs das contas envolvidas */
  accounts: string[];
  /** Nomes das contas para exibição */
  accountNames: string[];
}

/**
 * Resultado de uma atualização de estoque individual
 */
export interface StockUpdateResult {
  itemId: string;
  variationId?: number;
  success: boolean;
  error?: string;
  previousQuantity: number;
  newQuantity: number;
}

/**
 * Operação de sincronização de estoque
 * Registra uma sincronização manual ou automática
 */
export interface StockSyncOperation {
  id: string;
  /** SKU do grupo sincronizado */
  groupSku: string;
  /** Quantidade alvo definida */
  targetQuantity: number;
  /** IDs dos anúncios afetados */
  announcementIds: string[];
  /** Status da operação */
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  /** Resultados individuais por anúncio/variação */
  results: StockUpdateResult[];
  /** Origem da sincronização */
  origin: 'manual' | 'webhook';
  /** ID do pedido que disparou (quando origin = 'webhook') */
  orderId?: string;
  /** Usuário que executou (quando origin = 'manual') */
  executedBy?: {
    uid: string;
    email: string;
    displayName: string | null;
  };
  /** Data de criação */
  createdAt: string;
  /** Data de conclusão */
  completedAt?: string;
}

/**
 * Payload para atualização de estoque via API
 */
export interface StockUpdatePayload {
  itemId: string;
  variationId?: number;
  quantity: number;
  accountId: string;
}

/**
 * Resposta da API de atualização de estoque
 */
export interface StockUpdateResponse {
  success: boolean;
  results: StockUpdateResult[];
  syncOperationId?: string;
}

// ============================================
// ATUALIZAÇÃO DE PREÇO
// ============================================

/**
 * Resultado de uma atualização de preço individual
 */
export interface PriceUpdateResult {
  itemId: string;
  success: boolean;
  error?: string;
  previousPrice: number;
  newPrice: number;
}

/**
 * Payload para atualização de preço via API
 */
export interface PriceUpdatePayload {
  itemId: string;
  price: number;
  accountId: string;
}

/**
 * Resposta da API de atualização de preço
 */
export interface PriceUpdateResponse {
  success: boolean;
  results: PriceUpdateResult[];
  summary: {
    total: number;
    success: number;
    failed: number;
  };
}

// ============================================
// ATIVAÇÃO DE FLEX
// ============================================

/**
 * Resultado de ativação Flex individual
 */
export interface FlexActivationResult {
  itemId: string;
  success: boolean;
  error?: string;
  wasAlreadyActive?: boolean;
}

/**
 * Payload para ativação Flex via API
 */
export interface FlexActivationPayload {
  itemId: string;
  accountId: string;
  os: string;
}

/**
 * Resposta da API de ativação Flex
 */
export interface FlexActivationResponse {
  success: boolean;
  results: FlexActivationResult[];
  summary: {
    total: number;
    activated: number;
    alreadyActive: number;
    failed: number;
  };
}

// ============================================
// ATUALIZAÇÃO DE SKU
// ============================================

/**
 * Resultado de atualização de SKU individual
 */
export interface SkuUpdateResult {
  itemId: string;
  success: boolean;
  error?: string;
  previousSku: string | null;
  newSku: string;
}

/**
 * Payload para atualização de SKU via API
 */
export interface SkuUpdatePayload {
  itemId: string;
  accountId: string;
  newSku?: string; // Se não fornecido, usa o próprio itemId
}

/**
 * Resposta da API de atualização de SKU
 */
export interface SkuUpdateResponse {
  success: boolean;
  results: SkuUpdateResult[];
  summary: {
    total: number;
    updated: number;
    failed: number;
  };
}

// ============================================
// SUMMARY METRICS - Sistema de Resumo Dinâmico
// ============================================

export interface SummaryMetricCondition {
  field: string;                               // Campo a verificar (ex: 'systemStatus')
  operator: '==' | '!=' | '>' | '<' | '>=' | '<=' | 'includes' | 'excludes';
  value: any;                                  // Valor de comparação
}

export interface SummaryMetricFormula {
  metricIds: string[];                         // IDs de métricas necessárias
  expression: string;                          // Expressão matemática (ex: 'A - B - C')
  displayMode: 'value' | 'percentage' | 'both';
}

export interface SummaryMetricSecondaryValue {
  type: 'percentage' | 'ratio' | 'difference';
  numeratorMetricId: string;                   // ID da métrica numerador
  denominatorMetricId: string;                 // ID da métrica denominador
  format: string;                              // Ex: "{value}%" ou "{value}x"
  decimals?: number;                           // Casas decimais (padrão: 2)
}

export interface SummaryMetric {
  id: string;                                  // Identificador único
  label: string;                               // Nome exibido ao usuário
  type: 'sum' | 'average' | 'count' | 'min' | 'max' | 'calculated';
  
  // Para métricas simples (sum, average, count, min, max)
  sourceField?: string;                        // Campo da venda (ex: 'value_with_shipping')
  
  // Para métricas calculadas
  formula?: SummaryMetricFormula;              // Fórmula usando outras métricas
  
  // Filtros condicionais
  condition?: SummaryMetricCondition;          // Condição para incluir venda no cálculo
  
  // Valor secundário (ex: percentual)
  secondaryValue?: SummaryMetricSecondaryValue;
  
  // Apresentação
  color: string;                               // Cor do card (ex: 'primary', 'green-600')
  format: 'currency' | 'number' | 'percentage';
  icon?: string;                               // Nome do ícone Lucide (opcional)
  
  // Estado
  visible: boolean;                            // Se está visível
  order: number;                               // Ordem de exibição
  isDefault: boolean;                          // Se é métrica padrão do sistema
  
  // Metadata
  createdAt?: string;
  updatedAt?: string;
}

export interface SummaryConfig {
  metrics: SummaryMetric[];
  layout: 'grid-2' | 'grid-3' | 'grid-4' | 'grid-5' | 'auto';
  updatedAt?: string;
}

export interface MetricResult {
  value: number;
  secondaryValue?: number;                     // Ex: percentual
  secondaryLabel?: string;                     // Ex: "25.5%"
  formattedValue: string;                      // Valor formatado (ex: "R$ 1.234,56")
  formattedSecondary?: string;                 // Secundário formatado
  label: string;
  color: string;
  icon?: string;
}

// Garantia - Produtos recebidos de clientes para reparo/troca
export type WarrantyStatus = 'received' | 'analyzing' | 'approved' | 'rejected' | 'shipped';

export interface WarrantyLog {
  id: string;
  // Identificação do produto
  productId: string;
  productName: string;
  sku: string;
  serialNumber: string;
  orderNumber?: string;

  // Status do fluxo
  status: WarrantyStatus;

  // Detalhes
  defectDescription: string;
  analysisNotes?: string;
  rejectionReason?: string;

  // Rastreamento de datas
  receivedAt: string;
  analyzedAt?: string;
  resolvedAt?: string;
  shippedAt?: string;

  // Auditoria
  createdBy: { uid: string; email: string; displayName: string | null };
  updatedBy?: { uid: string; email: string; displayName: string | null };

  // Envio (quando concluído)
  shippedSerialNumber?: string;
  shippedFromInventoryId?: string;
}

// Snapshot diário do fluxo de caixa para histórico/relatórios
export interface CashFlowSnapshot {
  id?: string;
  date: string; // YYYY-MM-DD

  // Totais consolidados
  totalBankBalance: number;
  totalToReceiveToday: number;
  totalToReceiveWeek: number;
  projectedTotal: number;

  // Por marketplace
  magaluPayTotal: number;
  mercadoPagoTotal: number;
  manualBanksTotal: number;

  // Contadores
  accountsCount: number;
  forecastsCount: number;

  // Detalhes completos
  bankAccounts: Array<{ name: string; balance: number }>;
  forecasts: Array<{ marketplace: string; account: string; date: string; amount: number }>;
  accountDetails: {
    magaluPay: AccountDetail[];
    mercadoPago: AccountDetail[];
  };

  createdAt?: string;
}

// Projeção de Fluxo de Caixa - Despesas projetadas
export interface CashFlowProjectionExpense {
  id?: string;
  date: string;           // YYYY-MM-DD
  categoryCode: string;   // "3.1", "4.1", etc.
  categoryName: string;   // "Impostos", etc.
  amount: number;         // Valor (sempre negativo ou zero)
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
}

// Snapshot diário da Projeção de Fluxo de Caixa
export interface CashFlowProjectionSnapshot {
  id: string;                    // YYYY-MM-DD
  date: string;                  // Data do snapshot
  totalBankBalance: number;      // Saldo total em bancos
  totalExpenses: number;         // Total de despesas projetadas do dia
  saldoFinal: number;            // Saldo final (totalBankBalance + totalExpenses)

  // Detalhamento por categoria
  expensesByCategory: Array<{
    categoryCode: string;
    categoryName: string;
    amount: number;
  }>;

  // Projeção dos próximos 10 dias
  dailyProjection: Array<{
    date: string;
    saldoPrevisto: number;
    totalSaidas: number;
    saldoFinal: number;
    receivables: number;
    expenses: Array<{
      categoryCode: string;
      amount: number;
    }>;
  }>;

  createdAt: string;
}

// ============================================
// MERCADO LIVRE - NOVOS TIPOS DE ENRIQUECIMENTO
// ============================================

/**
 * Pergunta de um produto do Mercado Livre
 */
export interface ProductQuestion {
  id: number;
  text: string;
  answer: {
    text: string;
    date_created: string;
  } | null;
  date_created: string;
  item_id: string;
  seller_id?: number;
  from?: {
    id: number;
  };
  status: 'ANSWERED' | 'UNANSWERED' | 'BANNED' | 'DELETED';
}

/**
 * Opção de envio/frete simulada
 */
export interface ShippingSimulationOption {
  id: number;
  name: string;
  currency_id: string;
  list_cost: number;
  cost: number;
  estimated_delivery_time: {
    date: string | null;
    unit: string;
    offset: {
      date: string | null;
      shipping: number;
    };
  };
  estimated_handling_limit: {
    date: string | null;
  };
  estimated_schedule_limit: {
    date: string | null;
  };
}

/**
 * Resultado da simulação de frete
 */
export interface ShippingSimulationResult {
  success: boolean;
  itemId: string;
  zipCode: string;
  options: ShippingSimulationOption[];
  error?: string;
}

/**
 * Tendência de busca de uma categoria
 */
export interface CategoryTrendItem {
  keyword: string;
  url: string;
}

/**
 * Resultado da busca de tendências
 */
export interface CategoryTrendsResult {
  success: boolean;
  categoryId: string;
  trends: CategoryTrendItem[];
  error?: string;
}

/**
 * Informações de uma categoria do Mercado Livre
 */
export interface CategoryInfoResult {
  success: boolean;
  id: string;
  name: string;
  path_from_root: Array<{
    id: string;
    name: string;
  }>;
  children_categories?: Array<{
    id: string;
    name: string;
  }>;
  total_items_in_this_category?: number;
  error?: string;
}

export interface MlSearchResult {
    id: string;
    site_id: string;
    title: string;
    name?: string; // Optional alias
    seller: {
        id: number;
        nickname: string;
        permalink?: string;
        registration_date?: string;
        seller_reputation?: any; // Simplify to avoid conflict if MlAccount differs
        eshop?: {
            eshop_id: number;
            seller: number;
            nick_name: string;
            eshop_status_id: number;
            site_id: string;
            eshop_experience: number;
            eshop_rubro: any;
            eshop_locations: any[];
            eshop_logo_url: string;
        };
    };
    price: number;
    original_price: number | null;
    currency_id: string;
    available_quantity: number;
    sold_quantity: number;
    buying_mode: string;
    listing_type_id: string;
    stop_time: string;
    condition: string;
    permalink: string;
    thumbnail: string;
    accepts_mercadopago: boolean;
    installments: {
        quantity: number;
        amount: number;
        rate: number;
        currency_id: string;
    } | null;
    address: {
        state_id: string;
        state_name: string;
        city_id: string;
        city_name: string;
    };
    shipping: {
        free_shipping: boolean;
        mode: string;
        tags: string[];
        logistic_type: string;
        store_pick_up: boolean;
    };
    attributes: Array<{
        id: string;
        name: string;
        value_id: string | null;
        value_name: string | null;
        value_struct: any;
        values: any[];
        source: number;
    }>;
    pictures?: Array<{
        id: string;
        url: string;
        secure_url: string;
        size: string;
        max_size: string;
        quality: string;
    }>;
    // Helper properties added by us
    classicPrice?: number;
    premiumPrice?: number;
    classicFees?: any;
    premiumFees?: any;
    // Extra fields to satisfy ProductResult compatibility if needed, or we just use MlSearchResult
    catalog_product_id?: string;
    brand?: string;
    model?: string;
}

