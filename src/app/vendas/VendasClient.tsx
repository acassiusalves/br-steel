'use client';

import * as React from 'react';
import DashboardLayout from '@/components/dashboard-layout';
import SalesDashboard from '@/components/sales-dashboard';
import SalesListPage from '@/components/sales-list-page';
import { useSearchParams } from 'next/navigation';


export default function VendasClient() {
  const searchParams = useSearchParams();
  // Default to 'listagem' if no tab is specified, or handle as needed
  const tab = searchParams.get('tab') || 'dashboard'; 

  return (
    <DashboardLayout>
      <div className="flex-1 space-y-8 p-4 pt-6 md:p-8">
        {tab === 'dashboard' ? <SalesDashboard /> : <SalesListPage />}
      </div>
    </DashboardLayout>
  );
}
