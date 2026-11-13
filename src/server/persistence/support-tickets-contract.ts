import type {
  CreatedTicket, SupportTicket, TicketBreadcrumb, TicketCategory, TicketLog, TicketPerson, TicketStatus,
} from '@/types/support-tickets';
import type { WriteActor } from './write-audit';

export type NewTicket = {
  category: TicketCategory;
  description: string;
  fingerprint: string;
  createdBy: TicketPerson;
  context: Record<string, unknown>;
  domainContext: Record<string, unknown>;
  logs: TicketLog[];
  breadcrumbs: TicketBreadcrumb[];
};
/** Limite de envios por usuário numa janela; `null` libera (administradores registrando em reunião). */
export type TicketRateLimit = { max: number; windowSeconds: number } | null;

export interface SupportTicketRepository {
  /** `createdByUid` nulo traz todos os chamados (visão do administrador). */
  list(createdByUid: string | null, limit: number): Promise<SupportTicket[]>;
  create(input: NewTicket, rateLimit: TicketRateLimit, actor: WriteActor): Promise<CreatedTicket>;
  setStatus(id: string, status: TicketStatus, updatedBy: TicketPerson, actor: WriteActor): Promise<SupportTicket>;
  /** Só o autor reabre, e só um chamado resolvido. */
  reopen(id: string, details: string, reopenedBy: TicketPerson, actor: WriteActor): Promise<SupportTicket>;
}
