'use client';

import * as React from 'react';
import { useDroppable } from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';

import { KanbanCard } from './KanbanCard';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import type { ProductionColumn, ProductionLot } from '@/types/kanban';

interface KanbanColumnProps {
  column: ProductionColumn;
  lots: ProductionLot[];
}

export function KanbanColumn({ column, lots }: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: column.id,
  });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex flex-col w-80 min-w-[320px] bg-muted/50 rounded-lg',
        isOver && 'ring-2 ring-primary ring-offset-2'
      )}
    >
      {/* Header da coluna */}
      <div
        className="flex items-center justify-between p-3 border-b"
        style={{ borderLeftColor: column.color, borderLeftWidth: 4 }}
      >
        <div className="flex items-center gap-2">
          <span
            className="w-3 h-3 rounded-full"
            style={{ backgroundColor: column.color }}
          />
          <h3 className="font-semibold text-sm">{column.name}</h3>
          <span className="text-xs text-muted-foreground bg-background px-2 py-0.5 rounded-full">
            {lots.length}
          </span>
        </div>
      </div>

      {/* Lista de cards */}
      <ScrollArea className="flex-1 p-2">
        <SortableContext
          items={lots.map(lot => lot.id)}
          strategy={verticalListSortingStrategy}
        >
          <div className="flex flex-col gap-2 min-h-[100px]">
            {lots.length === 0 ? (
              <div className="flex items-center justify-center h-24 text-sm text-muted-foreground border-2 border-dashed rounded-lg">
                Arraste um lote aqui
              </div>
            ) : (
              lots.map(lot => (
                <KanbanCard key={lot.id} lot={lot} />
              ))
            )}
          </div>
        </SortableContext>
      </ScrollArea>
    </div>
  );
}
