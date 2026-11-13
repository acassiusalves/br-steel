import { Suspense } from 'react';
import EngineeringClient from './EngineeringClient';

export const dynamic = 'force-dynamic';

export default function EngineeringPage() {
  return (
    <Suspense fallback={<div className="p-4">Carregando engenharia...</div>}>
      <EngineeringClient />
    </Suspense>
  );
}
