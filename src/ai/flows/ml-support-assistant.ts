import { z } from 'genkit';
import { ai } from '@/ai/genkit';
import { ML_MESSAGE_MAX_LENGTH } from '@/lib/ml-chat-types';
import { getGeminiApiKeyAdmin } from '@/services/gemini-config';

export const MlSupportAssistantInputSchema = z.object({
  conversation: z.object({
    packId: z.string(),
    buyerName: z.string().nullable().optional(),
    status: z.string().nullable().optional(),
    substatus: z.string().nullable().optional(),
    shippingId: z.union([z.string(), z.number()]).nullable().optional(),
    claimId: z.union([z.string(), z.number()]).nullable().optional(),
    sellerMaxMessageLength: z.number().nullable().optional(),
    queueStatus: z.string().nullable().optional(),
    priority: z.string().nullable().optional(),
  }),
  supportContext: z
    .object({
      matchedBy: z.string().nullable().optional(),
      listing: z
        .object({
          itemId: z.string().nullable().optional(),
          title: z.string().nullable().optional(),
          sellerSku: z.string().nullable().optional(),
          status: z.string().nullable().optional(),
          price: z.number().nullable().optional(),
          availableQuantity: z.number().nullable().optional(),
          soldQuantity: z.number().nullable().optional(),
          visitsLast30Days: z.number().nullable().optional(),
          qualityScore: z.number().nullable().optional(),
          logisticType: z.string().nullable().optional(),
          freeShipping: z.boolean().nullable().optional(),
          adsCost: z.number().nullable().optional(),
          adsRoas: z.number().nullable().optional(),
          adsAcos: z.number().nullable().optional(),
          adsClicks: z.number().nullable().optional(),
          adsCtr: z.number().nullable().optional(),
        })
        .nullable()
        .optional(),
      items: z
        .array(
          z.object({
            itemId: z.string().nullable().optional(),
            title: z.string().nullable().optional(),
            sellerSku: z.string().nullable().optional(),
            quantity: z.number().nullable().optional(),
            unitPrice: z.number().nullable().optional(),
            totalAmount: z.number().nullable().optional(),
          })
        )
        .max(8)
        .optional(),
      order: z
        .object({
          orderIds: z.array(z.string()).optional(),
          shippingId: z.union([z.string(), z.number()]).nullable().optional(),
          claimId: z.union([z.string(), z.number()]).nullable().optional(),
          totalAmount: z.number().nullable().optional(),
          status: z.string().nullable().optional(),
          createdAt: z.string().nullable().optional(),
        })
        .nullable()
        .optional(),
      alerts: z
        .array(
          z.object({
            severity: z.enum(['info', 'warning', 'critical', 'positive']),
            title: z.string(),
            description: z.string(),
          })
        )
        .max(8)
        .optional(),
    })
    .nullable()
    .optional(),
  messages: z
    .array(
      z.object({
        direction: z.enum(['in', 'out']),
        text: z.string(),
        createdAt: z.string().nullable().optional(),
        moderationStatus: z.string().nullable().optional(),
      })
    )
    .max(40),
});
export type MlSupportAssistantInput = z.infer<typeof MlSupportAssistantInputSchema>;

export const MlSupportAssistantOutputSchema = z.object({
  summary: z.string().describe('Resumo objetivo da conversa em uma frase.'),
  intent: z.string().describe('Intencao principal do comprador.'),
  urgency: z.enum(['low', 'normal', 'high', 'urgent']),
  confidence: z.number().min(0).max(1),
  suggestedReply: z
    .string()
    .max(ML_MESSAGE_MAX_LENGTH)
    .describe('Resposta pronta para enviar ao comprador, com no maximo 350 caracteres.'),
  nextAction: z.string().describe('Proxima acao recomendada para o atendente.'),
  risks: z.array(z.string()).describe('Riscos, dados faltantes ou cuidados antes do envio.'),
  needsHumanReview: z.boolean(),
});
export type MlSupportAssistantOutput = z.infer<typeof MlSupportAssistantOutputSchema>;

const SYSTEM_PROMPT = `Você é um copiloto de atendimento pós-venda da BR Steel no Mercado Livre.

Objetivo: ajudar o atendente humano a responder com clareza, educação e segurança.

Regras obrigatórias:
1. Não invente prazo, rastreio, nota fiscal, reembolso, troca ou disponibilidade sem dados no contexto.
2. Não peça contato fora do Mercado Livre.
3. Não prometa exceções comerciais, cancelamento, estorno ou envio manual.
4. Se faltarem dados, peça uma confirmação objetiva ou recomende ação interna.
5. A resposta sugerida deve ter no máximo 350 caracteres.
6. Use português do Brasil, tom profissional e direto.
7. Se houver claim, bloqueio, moderação ou risco, marque needsHumanReview=true.`;

function money(value?: number | null): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
    : 'não informado';
}

function numberText(value?: number | null): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? value.toLocaleString('pt-BR')
    : 'não informado';
}

function percentText(value?: number | null): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'não informado';
  const normalized = value <= 1 ? value * 100 : value;
  return `${normalized.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
}

function buildSupportContextPrompt(input: MlSupportAssistantInput): string {
  const context = input.supportContext;
  if (!context) return 'Sem contexto estruturado de produto/pedido disponível.';

  const listing = context.listing;
  const itemLines = (context.items || [])
    .slice(0, 5)
    .map((item) => {
      const qty = item.quantity != null ? `, qtd. ${numberText(item.quantity)}` : '';
      const unit = item.unitPrice != null ? `, unit. ${money(item.unitPrice)}` : '';
      return `- ${item.title || item.itemId || 'item sem titulo'}${item.sellerSku ? `, SKU ${item.sellerSku}` : ''}${qty}${unit}`;
    })
    .join('\n');
  const alertLines = (context.alerts || [])
    .map((alert) => `- ${alert.severity.toUpperCase()}: ${alert.title} - ${alert.description}`)
    .join('\n');

  return `Contexto estruturado para apoiar a resposta:
- Cruzamento: ${context.matchedBy || 'não informado'}
- Anúncio: ${listing?.title || 'não identificado'}
- MLB: ${listing?.itemId || 'não informado'}
- SKU: ${listing?.sellerSku || 'não informado'}
- Status do anúncio: ${listing?.status || 'não informado'}
- Preço: ${money(listing?.price)}
- Estoque no ML: ${numberText(listing?.availableQuantity)}
- Vendidos: ${numberText(listing?.soldQuantity)}
- Visitas 30d: ${numberText(listing?.visitsLast30Days)}
- Qualidade: ${percentText(listing?.qualityScore)}
- Logística: ${listing?.logisticType || 'não informado'}
- Frete grátis: ${listing?.freeShipping == null ? 'não informado' : listing.freeShipping ? 'sim' : 'não'}
- Ads ROAS: ${numberText(listing?.adsRoas)}
- Ads ACOS: ${percentText(listing?.adsAcos)}
- Ads custo: ${money(listing?.adsCost)}
- Ads cliques: ${numberText(listing?.adsClicks)}
- Ads CTR: ${percentText(listing?.adsCtr)}
- Pedido: ${(context.order?.orderIds || []).join(', ') || 'não informado'}
- Status do pedido: ${context.order?.status || 'não informado'}
- Total do pedido: ${money(context.order?.totalAmount)}
- Envio: ${context.order?.shippingId || input.conversation.shippingId || 'não informado'}
- Claim: ${context.order?.claimId || input.conversation.claimId || 'não informado'}
- Criado em: ${context.order?.createdAt || 'não informado'}

Itens:
${itemLines || '- não informado'}

Alertas operacionais:
${alertLines || '- sem alertas relevantes'}`;
}

export const mlSupportAssistantFlow = ai.defineFlow(
  {
    name: 'mlSupportAssistantFlow',
    inputSchema: MlSupportAssistantInputSchema,
    outputSchema: MlSupportAssistantOutputSchema,
  },
  async (input) => {
    const transcript = input.messages
      .map((m) => {
        const who = m.direction === 'in' ? 'Cliente' : 'BR Steel';
        return `- ${who}${m.createdAt ? ` (${m.createdAt})` : ''}: ${m.text}`;
      })
      .join('\n');

    const apiKey = await getGeminiApiKeyAdmin().catch(() => '');
    const supportContextPrompt = buildSupportContextPrompt(input);
    const { output } = await ai.generate({
      model: 'googleai/gemini-2.5-flash',
      system: SYSTEM_PROMPT,
      prompt: `Analise esta conversa do Mercado Livre e gere apoio ao atendente.

Contexto:
- Pack: ${input.conversation.packId}
- Comprador: ${input.conversation.buyerName || 'não informado'}
- Status ML: ${input.conversation.status || 'não informado'}
- Substatus ML: ${input.conversation.substatus || 'não informado'}
- Envio: ${input.conversation.shippingId || 'não informado'}
- Claim: ${input.conversation.claimId || 'não informado'}
- Status interno: ${input.conversation.queueStatus || 'não informado'}
- Prioridade interna: ${input.conversation.priority || 'não informado'}
- Limite de mensagem: ${input.conversation.sellerMaxMessageLength || ML_MESSAGE_MAX_LENGTH}

${supportContextPrompt}

Orientação de uso do contexto:
- Use dados do produto/pedido apenas quando eles forem relevantes para a dúvida do cliente.
- Se o atendimento for sobre entrega, priorize dados de pedido, envio, claim e status; não cite estoque/status do anúncio se isso puder confundir uma compra já feita.
- Se o anúncio estiver pausado, sem estoque ou com alerta crítico, trate como cuidado interno. Não afirme disponibilidade sem confirmar.
- Se não houver envio/rastreio no contexto, não invente prazo.
- Métricas de visitas, qualidade e Ads são para orientar o atendente; só cite ao cliente se a pergunta for sobre anúncio/produto e fizer sentido.

Histórico:
${transcript || 'Sem mensagens disponíveis.'}

Retorne JSON estruturado. A resposta sugerida deve ser segura para o atendente revisar e enviar.`,
      output: { schema: MlSupportAssistantOutputSchema },
      config: {
        temperature: 0.2,
        ...(apiKey ? { apiKey } : {}),
      },
    });

    if (!output) {
      return {
        summary: 'Não foi possível gerar resumo da conversa.',
        intent: 'indefinido',
        urgency: 'normal' as const,
        confidence: 0,
        suggestedReply: '',
        nextAction: 'Revisar a conversa manualmente.',
        risks: ['Gemini não retornou uma saída estruturada.'],
        needsHumanReview: true,
      };
    }

    return {
      ...output,
      suggestedReply: output.suggestedReply.trim().slice(0, ML_MESSAGE_MAX_LENGTH),
      risks: output.risks.slice(0, 6),
      needsHumanReview:
        output.needsHumanReview ||
        !!input.conversation.claimId ||
        input.conversation.status === 'blocked',
    };
  }
);
