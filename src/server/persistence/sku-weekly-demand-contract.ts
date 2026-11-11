import type { HistoryPoint } from './production-demand-contract';

export type RollupResult = { weeks: string[]; skus: number; remaining: number };

export interface SkuWeeklyDemandRepository {
  rollUpPendingWeeks(now?: Date, budgetMs?: number): Promise<RollupResult>;
  readWeeklyHistory(weeks: number): Promise<Map<string, HistoryPoint[]>>;
}
