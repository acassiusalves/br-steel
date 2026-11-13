'use client';
import { fetchOperation } from '@/lib/operation-client';
import type { CreatedTicket, SupportTicket, TicketBreadcrumb, TicketCategory, TicketList, TicketLog, TicketScope, TicketStatus } from '@/types/support-tickets';

const PATH = '/api/operations/support-tickets';
/** Disparado depois de um envio, para as listas abertas recarregarem. */
export const TICKET_CREATED_EVENT = 'support-ticket-created';

const post = async <T,>(action: string, data: unknown) => (await fetchOperation<T>(PATH, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, data }),
})).data;

export async function listTickets(scope: TicketScope): Promise<TicketList> {
  return (await fetchOperation<TicketList>(`${PATH}?scope=${scope}`)).data;
}
export function createTicket(input: {
  category: TicketCategory; description: string; context: Record<string, unknown>; logs: TicketLog[];
  breadcrumbs: TicketBreadcrumb[]; domainContext: Record<string, unknown>;
}) { return post<CreatedTicket>('create', input); }
export function updateTicketStatus(id: string, status: TicketStatus) { return post<SupportTicket>('setStatus', { id, status }); }
export function reopenTicket(id: string, details: string) { return post<SupportTicket>('reopen', { id, details }); }
