import { Suspense } from 'react';
import OrdersClient from './OrdersClient';

export const dynamic = 'force-dynamic';

export default function OrdersPage() {
  return (
    <Suspense fallback={<div className="p-4">Carregando ordens de produção...</div>}>
      <OrdersClient />
    </Suspense>
  );
}
