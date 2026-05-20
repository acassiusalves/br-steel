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
