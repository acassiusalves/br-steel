'use server';

/**
 * @fileOverview An AI agent for predicting sales trends based on historical data.
 *
 * - predictSalesTrends - A function that handles the sales trend prediction process.
 * - PredictSalesTrendsInput - The input type for the predictSalesTrends function.
 * - PredictSalesTrendsOutput - The return type for the predictSalesTrends function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const PredictSalesTrendsInputSchema = z.object({
  historicalSalesData: z
    .string()
    .describe(
      'Historical sales data in CSV or Excel format. Include date, product, quantity, price, and marketplace columns.'
    ),
});
export type PredictSalesTrendsInput = z.infer<typeof PredictSalesTrendsInputSchema>;

const PredictSalesTrendsOutputSchema = z.object({
  summary: z.string().describe('A summary of the predicted sales trends.'),
  keyFactors: z
    .string()
    .describe(
      'Key factors influencing sales trends, such as seasonality, product performance, and marketplace trends.'
    ),
  recommendations: z
    .string()
    .describe(
      'Recommendations for inventory management and marketing campaigns based on predicted sales trends.'
    ),
});
export type PredictSalesTrendsOutput = z.infer<typeof PredictSalesTrendsOutputSchema>;

export async function predictSalesTrends(
  input: PredictSalesTrendsInput
): Promise<PredictSalesTrendsOutput> {
  return predictSalesTrendsFlow(input);
}

const prompt = ai.definePrompt({
  name: 'predictSalesTrendsPrompt',
  input: {schema: PredictSalesTrendsInputSchema},
  output: {schema: PredictSalesTrendsOutputSchema},
  prompt: `You are a sales analyst specializing in predicting future sales trends.

Analyze the historical sales data to identify patterns and predict future trends. Provide a summary of the predicted trends, key factors influencing these trends, and recommendations for inventory management and marketing campaigns.

Historical Sales Data: {{{historicalSalesData}}}`,
});

const predictSalesTrendsFlow = ai.defineFlow(
  {
    name: 'predictSalesTrendsFlow',
    inputSchema: PredictSalesTrendsInputSchema,
    outputSchema: PredictSalesTrendsOutputSchema,
  },
  async input => {
    const {output} = await prompt(input);
    return output!;
  }
);
