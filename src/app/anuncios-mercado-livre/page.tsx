import { Suspense } from 'react';
import AnunciosMercadoLivreClient from './AnunciosMercadoLivreClient';

export const dynamic = 'force-dynamic';

export default function Page() {
  return (
    <Suspense fallback={<div className="p-4">Carregando anuncios...</div>}>
      <AnunciosMercadoLivreClient />
    </Suspense>
  );
}
