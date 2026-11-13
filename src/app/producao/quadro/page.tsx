import { Suspense } from 'react';
import BoardClient from './BoardClient';

export const dynamic = 'force-dynamic';

export default function BoardPage() {
  return (
    <Suspense fallback={<div className="p-4">Carregando Kanban de OPs...</div>}>
      <BoardClient />
    </Suspense>
  );
}
