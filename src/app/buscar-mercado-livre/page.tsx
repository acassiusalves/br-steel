import { Suspense } from 'react';
import BuscarMercadoLivreClient from './BuscarMercadoLivreClient';

export default function BuscarMercadoLivrePage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Carregando busca Mercado Livre...</div>}>
      <BuscarMercadoLivreClient />
    </Suspense>
  );
}
