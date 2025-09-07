// src/app/insumos/page.tsx  (Server Component)
import { Suspense } from 'react';
import InsumosClient from './InsumosClient';

export const dynamic = 'force-dynamic'; // evita SSG e mata o erro no build
export default function Page() {
  return (
    <Suspense fallback={<div className="p-4">Carregando…</div>}>
      <InsumosClient />
    </Suspense>
  );
}
