// Tipos para o sistema Kanban de controle de produção

export type LotPriority = 'baixa' | 'normal' | 'alta' | 'urgente';

export interface ProductionColumn {
  id: string;
  name: string;
  order: number;
  color: string;
  createdAt: string;
  updatedAt: string;
}

export interface AssignedUser {
  userId: string;
  userName: string;
  assignedAt: string;
}

export interface LotCreator {
  userId: string;
  userName: string;
}

export interface ProductionLot {
  id: string;
  lotNumber: string;
  title: string;
  description?: string;
  columnId: string;
  columnOrder: number;
  assignedTo?: AssignedUser;
  priority: LotPriority;
  linkedOrderIds: number[];
  totalItems: number;
  totalSkus: number;
  dueDate?: string;
  createdAt: string;
  updatedAt: string;
  createdBy: LotCreator;
}

export interface ProductionLotItem {
  id: string;
  lotId: string;
  sku: string;
  productName: string;
  quantity: number;
  unit: string;
  sourceOrderId: number;
  sourceOrderNumber: string;
  customerName: string;
  createdAt: string;
}

export interface CommentAuthor {
  userId: string;
  userName: string;
}

export interface ProductionComment {
  id: string;
  lotId: string;
  content: string;
  author: CommentAuthor;
  createdAt: string;
  updatedAt?: string;
}

// Tipos auxiliares para criação

export interface CreateColumnInput {
  name: string;
  order: number;
  color: string;
}

export interface UpdateColumnInput {
  name?: string;
  order?: number;
  color?: string;
}

export interface CreateLotInput {
  title: string;
  description?: string;
  columnId: string;
  priority: LotPriority;
  assignedTo?: AssignedUser;
  dueDate?: string;
  items: CreateLotItemInput[];
  createdBy: LotCreator;
}

export interface CreateLotItemInput {
  sku: string;
  productName: string;
  quantity: number;
  unit: string;
  sourceOrderId: number;
  sourceOrderNumber: string;
  customerName: string;
}

export interface UpdateLotInput {
  title?: string;
  description?: string;
  columnId?: string;
  columnOrder?: number;
  priority?: LotPriority;
  assignedTo?: AssignedUser | null;
  dueDate?: string | null;
}

export interface CreateCommentInput {
  lotId: string;
  content: string;
  author: CommentAuthor;
}

// Tipos para estado do Kanban

export interface KanbanState {
  columns: ProductionColumn[];
  lots: ProductionLot[];
  isLoading: boolean;
  error: string | null;
}

// Constantes de cores padrão para colunas
export const DEFAULT_COLUMN_COLORS = {
  fila: '#6b7280',      // gray-500
  emProducao: '#f59e0b', // amber-500
  concluido: '#22c55e',  // green-500
};

// Cores para prioridades
export const PRIORITY_COLORS: Record<LotPriority, { bg: string; text: string; border: string }> = {
  baixa: { bg: 'bg-slate-100', text: 'text-slate-700', border: 'border-slate-300' },
  normal: { bg: 'bg-blue-100', text: 'text-blue-700', border: 'border-blue-300' },
  alta: { bg: 'bg-orange-100', text: 'text-orange-700', border: 'border-orange-300' },
  urgente: { bg: 'bg-red-100', text: 'text-red-700', border: 'border-red-300' },
};

// Labels em português
export const PRIORITY_LABELS: Record<LotPriority, string> = {
  baixa: 'Baixa',
  normal: 'Normal',
  alta: 'Alta',
  urgente: 'Urgente',
};
