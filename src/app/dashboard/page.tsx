import DashboardLayout from '@/components/dashboard-layout';
import SalesDashboard from '@/components/sales-dashboard';

export default function DashboardPage() {
  return (
    <DashboardLayout>
      <div className="flex-1 space-y-12 p-4 pt-6 md:p-8">
        <div id="painel" className="pt-16 -mt-16">
          <SalesDashboard />
        </div>
      </div>
    </DashboardLayout>
  );
}
