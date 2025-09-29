
// src/app/perfil/page.tsx  (Server Component)
import { Suspense } from 'react';
import PerfilPageClient from './PerfilPageClient';

export const dynamic = 'force-dynamic'; // Evita SSG quando depende de query

export default function PerfilPage() {
  return (
    <Suspense fallback={<div className="p-4">Carregando Perfil…</div>}>
      <PerfilPageClient />
    </Suspense>
  );
}
