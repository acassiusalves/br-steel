'use server';

import { format, subMonths } from 'date-fns';
import {
  collection,
  getDocs,
  query,
  where,
  type QueryConstraint,
} from 'firebase/firestore';

import { db } from '@/lib/firebase';
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
  const today = new Date();
  const from = input.from || subMonths(today, 12);
  const to = input.to || today;
  const fromDateStr = format(from, 'yyyy-MM-dd');
  const toDateStr = format(to, 'yyyy-MM-dd');
  const constraints: QueryConstraint[] = [
    where('data', '>=', fromDateStr),
    where('data', '<=', toDateStr),
  ];

  const [ordersSnapshot, groupIndex] = await Promise.all([
    getDocs(query(collection(db, 'salesOrders'), ...constraints)),
    loadProductGroupIndex().catch(() => ({
      groups: [],
      skuToGroup: new Map(),
    })),
  ]);

  const orders: SaleOrder[] = [];
  ordersSnapshot.forEach((doc) => {
    orders.push(doc.data() as SaleOrder);
  });

  return computeCustomerProductRecurrence(orders, {
    currentDate: format(today, 'yyyy-MM-dd'),
    minDistinctPurchaseDates: input.minDistinctPurchaseDates,
    lookaheadDays: input.lookaheadDays,
    includeReturns: input.includeReturns,
    onlyWithInvoice: input.onlyWithInvoice,
    skuGroups: groupIndex.skuToGroup,
  });
}
