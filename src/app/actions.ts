"use server";

import {
  predictSalesTrends,
  type PredictSalesTrendsInput,
  type PredictSalesTrendsOutput,
} from "@/ai/flows/predict-sales-trends";

export async function getSalesPrediction(
  input: PredictSalesTrendsInput
): Promise<PredictSalesTrendsOutput> {
  // Simple pass-through to the AI flow.
  // In a real app, you might add more logic here, like authentication,
  // data validation, or logging.
  const prediction = await predictSalesTrends(input);
  return prediction;
}
