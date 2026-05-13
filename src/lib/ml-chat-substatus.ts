/**
 * Tradução amigável dos substatus de conversa bloqueada do ML.
 * Fonte: https://developers.mercadolivre.com.br/pt_br/mensagens-bloqueadas
 */

import type { MlConversationSubstatus } from './ml-chat-types';

export const SUBSTATUS_LABELS: Record<string, { label: string; description: string }> = {
  blocked_by_time: {
    label: 'Prazo expirado',
    description: 'O prazo para receber mensagens expirou (30 dias). Só será reaberto se o comprador iniciar nova mensagem.',
  },
  blocked_by_buyer: {
    label: 'Bloqueado pelo comprador',
    description: 'O comprador decidiu bloquear o recebimento de mensagens.',
  },
  blocked_by_mediation: {
    label: 'Mediação em andamento',
    description: 'Existe uma mediação em andamento entre comprador e vendedor.',
  },
  blocked_by_fulfillment: {
    label: 'Aguardando entrega (Full)',
    description: 'Venda Full ainda não entregue. Mensageria libera após status "delivered".',
  },
  blocked_by_payment: {
    label: 'Pagamento pendente',
    description: 'Pagamento ainda não foi realizado/processado. Bloqueio temporário.',
  },
  blocked_by_conversation_initiated_by_seller: {
    label: 'Conversa iniciada pelo vendedor',
    description: 'Venda Supermercado iniciada pelo vendedor (AR/MX/BR).',
  },
  blocked_by_conversation_use_message_api: {
    label: 'Use action-guide',
    description: 'O vendedor tentou comunicar via action-guide quando o comprador já iniciou a conversa.',
  },
  blocked_by_conversation_initiated_by_seller_limited: {
    label: 'Use motivos para se comunicar',
    description: 'Venda com Mercado Envíos 2 — use o recurso "Motivos para se comunicar".',
  },
  blocked_by_cancelled_order: {
    label: 'Pedido cancelado',
    description: 'Não é possível se comunicar — a venda foi cancelada.',
  },
  blocked_by_cancelled_order_by_fraud: {
    label: 'Cancelada por fraude',
    description: 'Venda cancelada por comportamentos irregulares.',
  },
  blocked_by_mediation_fbm: {
    label: 'Mediação Full',
    description: 'Existe uma mediação em andamento em uma venda Fulfillment.',
  },
  blocked_by_conversation_expired: {
    label: 'Conversa expirada',
    description: 'Mais de 18 meses se passaram desde a data da compra.',
  },
  blocked_by_refund: {
    label: 'Reembolso realizado',
    description: 'Foi realizado um reembolso parcial ou total. Só reabre se o comprador enviar nova mensagem.',
  },
  blocked_by_claim_change_closed: {
    label: 'Troca encerrada',
    description: 'Mensageria de reclamação bloqueada por troca de produto.',
  },
  blocked_by_claim_change_open: {
    label: 'Troca em andamento',
    description: 'Existe uma troca de produto em andamento associada à ordem.',
  },
  blocked_by_deactivated_account: {
    label: 'Conta desativada',
    description: 'Comprador ou vendedor excluiu a conta.',
  },
  blocked_by_restrictions: {
    label: 'Restrições no perfil',
    description: 'Existe uma restrição sobre o vendedor ou comprador.',
  },
  blocked_by_cancelled_order_hidden: {
    label: 'Compra não processada',
    description: 'A compra não conseguiu ser processada. A ordem só é visível ao comprador.',
  },
  blocked_by_message_pending_review: {
    label: 'Conversa em revisão',
    description: 'A conversa está sob revisão. Poderá ser usada após a revisão.',
  },
  blocked_by_return_to_buyer_fulfillment: {
    label: 'Devolução ao comprador (Full)',
    description: 'Após revisão Full, o produto será devolvido ao comprador.',
  },
  blocked_by_ai_assistant: {
    label: 'Assistente IA ativo',
    description: 'Venda Fulfillment com assistente de IA habilitado para o comprador.',
  },
  blocked_by_ai_assistant_expired: {
    label: 'Assistente IA expirado',
    description: 'A mensageria com o assistente de IA expirou.',
  },
  blocked_by_ai_assistant_contact_closed: {
    label: 'Assistente IA — consulta encerrada',
    description: 'A consulta com o assistente de IA foi finalizada.',
  },
};

export function describeSubstatus(
  substatus?: MlConversationSubstatus | string | null
): { label: string; description: string } {
  if (!substatus) return { label: 'Bloqueada', description: 'Conversa bloqueada (sem motivo informado).' };
  return (
    SUBSTATUS_LABELS[substatus] || {
      label: substatus,
      description: 'Substatus retornado pelo ML (não traduzido).',
    }
  );
}
