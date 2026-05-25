import { Suspense } from 'react';
import DeepSearchClient from './DeepSearchClient';

export default function BuscarMercadoLivreDeepSearchPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Carregando Deep Search...</div>}>
      <DeepSearchClient />
    </Suspense>
  );
}
