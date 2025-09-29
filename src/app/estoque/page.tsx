// src/app/estoque/page.tsx  (Server Component)
import { Suspense } from 'react';
import EstoqueClient from './EstoqueClient';

export const dynamic = 'force-dynamic'; // Evita o erro de build relacionado a hooks de cliente

export default function EstoquePage() {
  return (
    <Suspense fallback={<div className="p-4">Carregando Estoque…</div>}>
      <EstoqueClient />
    </Suspense>
  );
}
