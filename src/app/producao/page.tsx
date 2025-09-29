// src/app/producao/page.tsx  (Server Component)
import { Suspense } from 'react';
import ProducaoClient from './ProducaoClient';

// Evita SSG/Prerender quando há dependência de querystring
export const dynamic = 'force-dynamic';

export default function ProducaoPage() {
  return (
    <Suspense fallback={<div className="p-4">Carregando Produção…</div>}>
      <ProducaoClient />
    </Suspense>
  );
}