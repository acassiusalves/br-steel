import { Suspense } from 'react';
import ReportsPageView from '@/components/reports/ReportsPageView';

export const dynamic = 'force-dynamic';

export default function AdminReportsPage() {
  return (
    <Suspense fallback={<div className="p-4">Carregando reportes...</div>}>
      <ReportsPageView
        scope="admin"
        title="Reportes"
        subtitle="{count} chamados carregados"
        showUserColumn
        allowAdminActions
        emptyDescription="Ajuste os filtros ou aguarde novos reportes enviados pelo botão flutuante."
      />
    </Suspense>
  );
}
