import { Suspense } from 'react';
import ReportsPageView from '@/components/reports/ReportsPageView';

export const dynamic = 'force-dynamic';

export default function MyReportsPage() {
  return (
    <Suspense fallback={<div className="p-4">Carregando reportes...</div>}>
      <ReportsPageView
        scope="mine"
        title="Meus reportes"
        subtitle="{count} reportes enviados por você"
        emptyDescription="Os reportes que você enviar pelo botão de problemas aparecerão aqui."
      />
    </Suspense>
  );
}
