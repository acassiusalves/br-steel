import { Suspense } from 'react';
import KanbanClient from './KanbanClient';

export const dynamic = 'force-dynamic';

export default function KanbanPage() {
  return (
    <Suspense fallback={<div className="p-4">Carregando Kanban...</div>}>
      <KanbanClient />
    </Suspense>
  );
}
