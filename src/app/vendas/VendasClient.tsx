'use client';

import * as React from 'react';
import DashboardLayout from '@/components/dashboard-layout';
import SalesDashboard from '@/components/sales-dashboard';
import SalesListPage from '@/components/sales-list-page';
import SalesAbcCurve from '@/components/sales-abc-curve';
import { useSearchParams } from 'next/navigation';


export default function VendasClient() {
  const searchParams = useSearchParams();
  // Default to 'listagem' if no tab is specified, or handle as needed
  const tab = searchParams.get('tab') || 'dashboard';

  const content =
    tab === 'dashboard' ? <SalesDashboard />
    : tab === 'curva-abc' ? <SalesAbcCurve />
    : <SalesListPage />;

  return (
    <DashboardLayout>
      <div className="flex-1 space-y-8 p-4 pt-6 md:p-8">
        {content}
      </div>
    </DashboardLayout>
  );
}
