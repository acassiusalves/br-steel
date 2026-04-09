// src/ai/flows/group-products.ts
//
// Genkit flow that uses Gemini 2.5 Flash to cluster SKUs that represent the
// same physical product but are listed with different titles/marketplaces.
//
// Input: a list of distinct products (sku + description).
// Output: an array of groups; each group has a canonical name and the list of
// SKUs that belong to it. Only groups with more than one SKU are returned —
// single-SKU products are left untouched by the caller.
//
// This flow is intentionally small and cheap: we only ask Gemini to do the
// clustering, nothing else. The caller is responsible for filtering out SKUs
// already mapped before calling this flow.

import { z } from 'genkit';
import { ai } from '@/ai/genkit';

export const GroupProductsInputSchema = z.object({
  products: z
    .array(
      z.object({
        sku: z.string().describe('Código/SKU único do produto'),
        description: z.string().describe('Descrição/título do produto como aparece na venda'),
      })
    )
    .min(2)
    .describe('Lista de SKUs distintos a serem analisados'),
});
export type GroupProductsInput = z.infer<typeof GroupProductsInputSchema>;

export const GroupProductsOutputSchema = z.object({
  groups: z
    .array(
      z.object({
        canonicalName: z
          .string()
          .describe(
            'Nome canônico curto que representa o produto físico (sem referências a marketplace, sem códigos, sem plural).'
          ),
        skus: z
          .array(z.string())
          .min(2)
          .describe('Lista de SKUs que pertencem a este grupo (apenas SKUs presentes na entrada).'),
        reason: z
          .string()
          .describe('Explicação curta (1 frase) do por que esses SKUs foram agrupados.'),
      })
    )
    .describe('Grupos de produtos. Inclua APENAS grupos com 2 ou mais SKUs.'),
});
export type GroupProductsOutput = z.infer<typeof GroupProductsOutputSchema>;

const SYSTEM_PROMPT = `Você é um especialista em catálogo de produtos de uma indústria de aço inoxidável (BR Steel).
Sua tarefa é identificar quais SKUs representam o MESMO produto físico, mesmo que tenham títulos diferentes.

REGRAS DE AGRUPAMENTO:
1. Agrupe apenas produtos que são fisicamente IDÊNTICOS (mesmo tipo, mesmas dimensões, mesmo material, mesma variante).
2. Variações de dimensão, cor, acabamento ou modelo → NÃO são o mesmo produto. Nunca agrupe.
3. Diferença apenas no título (ex: "RALO LINEAR INOX - CONTINUUM 1000x90x60" vs "RALO INOX - FRONTAL 1000x90x60") pode ser o mesmo produto se as dimensões e o tipo baterem. Use bom senso.
4. Na dúvida, NÃO agrupe. É melhor deixar separado do que juntar errado.
5. Dimensões (ex: 1000x90x60) são o fator mais forte de identidade. Mesmo tipo + mesmas dimensões = candidato forte a grupo.
6. Retorne APENAS grupos com 2+ SKUs. Produtos únicos não devem aparecer na resposta.
7. O "canonicalName" deve ser descritivo e claro, sem referências a anúncio/marketplace (não use "CONTINUUM", "FRONTAL" se forem só nomes de linha comercial).
8. Cada SKU pode aparecer em no máximo UM grupo.
9. Nunca invente SKUs que não estão na entrada.`;

export const groupProductsFlow = ai.defineFlow(
  {
    name: 'groupProductsFlow',
    inputSchema: GroupProductsInputSchema,
    outputSchema: GroupProductsOutputSchema,
  },
  async (input) => {
    const productList = input.products
      .map((p, i) => `${i + 1}. [SKU: ${p.sku}] ${p.description}`)
      .join('\n');

    const { output } = await ai.generate({
      model: 'googleai/gemini-2.5-flash',
      system: SYSTEM_PROMPT,
      prompt: `Analise a lista abaixo e retorne os grupos de SKUs que representam o MESMO produto físico.

Lista de produtos:
${productList}

Lembre-se: retorne apenas grupos com 2+ SKUs; se nada pode ser agrupado com segurança, retorne uma lista vazia.`,
      output: { schema: GroupProductsOutputSchema },
      config: { temperature: 0 },
    });

    if (!output) {
      return { groups: [] };
    }

    // Defensive cleanup: drop groups with <2 SKUs and dedupe SKUs within a group.
    const validSkus = new Set(input.products.map((p) => p.sku));
    const seenSkus = new Set<string>();
    const cleaned = output.groups
      .map((g) => ({
        canonicalName: g.canonicalName.trim(),
        reason: g.reason.trim(),
        skus: Array.from(new Set(g.skus.filter((s) => validSkus.has(s)))),
      }))
      .filter((g) => g.skus.length >= 2)
      // Drop SKUs that the model tried to put in more than one group —
      // first group wins.
      .map((g) => {
        const keep = g.skus.filter((s) => !seenSkus.has(s));
        keep.forEach((s) => seenSkus.add(s));
        return { ...g, skus: keep };
      })
      .filter((g) => g.skus.length >= 2);

    return { groups: cleaned };
  }
);
