/** Chamados de erros e melhorias, no formato dos reportes do Calculaqui. */
export type TicketCategory = 'error' | 'improvement';
export type TicketStatus = 'pending' | 'in_progress' | 'resolved';
export type TicketScope = 'mine' | 'admin';

export type TicketPerson = { uid: string; email: string | null; name: string | null; role?: string | null };
export type TicketReopen = { details: string; reopenedAt: string; reopenedBy: TicketPerson };
export type TicketLog = {
  timestamp: string; level: 'error' | 'warn' | 'info'; source: string; message?: string; stack?: string; args?: unknown[];
};
export type TicketBreadcrumb = { timestamp: string; type: string; message: string; data?: Record<string, unknown> };

export interface SupportTicket {
  id: string;
  /** Número sequencial mostrado ao usuário (`#42`). O `id` continua sendo a chave. */
  ticketNumber: number;
  createdByUid: string;
  user: TicketPerson;
  category: TicketCategory;
  description: string;
  status: TicketStatus;
  source: string;
  fingerprint: string;
  context: Record<string, unknown>;
  domainContext: Record<string, unknown>;
  logs: TicketLog[];
  breadcrumbs: TicketBreadcrumb[];
  reopenHistory: TicketReopen[];
  reopenCount: number;
  updatedBy: TicketPerson | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

export type TicketList = { reports: SupportTicket[]; scope: { mode: 'own' | 'all'; canManage: boolean } };
export type CreatedTicket = { id: string; ticketNumber: number; fingerprint: string; category: TicketCategory };

export const STATUS_LABELS: Record<TicketStatus, string> = { pending: 'Pendente', in_progress: 'Em análise', resolved: 'Resolvido' };
export const CATEGORY_LABELS: Record<TicketCategory, string> = { error: 'Erro', improvement: 'Melhoria' };

export const formatTicketNumber = (value: number | null | undefined) => (value ? `#${value}` : '—');

/** Aceita "#42", "42" ou parte do número. */
export function matchesTicketNumber(value: number | null | undefined, term: string): boolean {
  if (!value) return false;
  const digits = term.replace(/[#\s]/g, '');
  return digits.length > 0 && /^\d+$/.test(digits) && String(value).includes(digits);
}
