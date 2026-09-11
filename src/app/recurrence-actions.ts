'use server';

import { format, subMonths } from 'date-fns';
import { requireWebContext } from '@/server/operations/context';
import { requireOperation, dateRangeSchema } from '@/server/operations/common';
import { readOrdersForPeriod } from '@/server/operations/sales';
import {
  computeCustomerProductRecurrence,
  type RecurrenceResult,
} from '@/lib/customer-product-recurrence';
import { loadProductGroupIndex } from '@/services/product-groups-service';
import type { SaleOrder } from '@/types/sale-order';

export type CustomerProductRecurrenceRequest = {
  from?: Date;
  to?: Date;
  minDistinctPurchaseDates?: number;
  lookaheadDays?: number;
  includeReturns?: boolean;
  onlyWithInvoice?: boolean;
};

export async function getCustomerProductRecurrenceData(
  input: CustomerProductRecurrenceRequest = {}
): Promise<RecurrenceResult> {
  requireOperation(await requireWebContext(), 'vendas:read');
  const today = new Date();
  const from = input.from || subMonths(today, 12);
  const to = input.to || today;
  const fromDateStr = format(from, 'yyyy-MM-dd');
  const toDateStr = format(to, 'yyyy-MM-dd');
  const range = dateRangeSchema.parse({ from: fromDateStr, to: toDateStr });
  const [orders, groupIndex] = await Promise.all([
    readOrdersForPeriod(range),
    loadProductGroupIndex().catch(() => ({ groups: [], skuToGroup: new Map() })),
  ]);

  return computeCustomerProductRecurrence(orders, {
    currentDate: format(today, 'yyyy-MM-dd'),
    minDistinctPurchaseDates: input.minDistinctPurchaseDates,
    lookaheadDays: input.lookaheadDays,
    includeReturns: input.includeReturns,
    onlyWithInvoice: input.onlyWithInvoice,
    skuGroups: groupIndex.skuToGroup,
  });
}
