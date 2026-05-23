import { Suspense } from 'react';

import AnaliseAdsClient from './AnaliseAdsClient';

export default function AnaliseAdsPage() {
  return (
    <Suspense fallback={<div className="p-4">Carregando analise Ads...</div>}>
      <AnaliseAdsClient />
    </Suspense>
  );
}
