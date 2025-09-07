// src/app/vendas/page.tsx  (SERVER)
import { Suspense } from 'react';
import VendasClient from './VendasClient';

export const dynamic = 'force-dynamic'; // garante render dinâmico (sem SSG) e mata o erro no build
export default function Page() {
  return (
    <Suspense fallback={<div className="p-4">Carregando Vendas…</div>}>
      <VendasClient />
    </Suspense>
  );
}
