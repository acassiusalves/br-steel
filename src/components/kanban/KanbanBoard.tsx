'use client';

import * as React from 'react';
import {
  DndContext,
  DragOverlay,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  horizontalListSortingStrategy,
} from '@dnd-kit/sortable';

import { KanbanColumn } from './KanbanColumn';
import { KanbanCard } from './KanbanCard';
import { moveLot, reorderLotsInColumn } from '@/services/kanban-service';
import { useToast } from '@/hooks/use-toast';
import type { ProductionColumn, ProductionLot } from '@/types/kanban';

interface KanbanBoardProps {
  columns: ProductionColumn[];
  lots: ProductionLot[];
}

export function KanbanBoard({ columns, lots }: KanbanBoardProps) {
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [optimisticLots, setOptimisticLots] = React.useState<ProductionLot[]>(lots);
  const { toast } = useToast();

  // Sincroniza quando lots mudam (do Firebase)
  React.useEffect(() => {
    setOptimisticLots(lots);
  }, [lots]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const activeLot = React.useMemo(() => {
    if (!activeId) return null;
    return optimisticLots.find(lot => lot.id === activeId);
  }, [activeId, optimisticLots]);

  const getLotsByColumn = React.useCallback(
    (columnId: string) => {
      return optimisticLots
        .filter(lot => lot.columnId === columnId)
        .sort((a, b) => a.columnOrder - b.columnOrder);
    },
    [optimisticLots]
  );

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event;

    if (!over) return;

    const activeId = active.id as string;
    const overId = over.id as string;

    const activeLot = optimisticLots.find(lot => lot.id === activeId);
    if (!activeLot) return;

    // Verifica se over é uma coluna
    const overColumn = columns.find(col => col.id === overId);

    if (overColumn) {
      // Movendo para uma coluna vazia ou o header da coluna
      if (activeLot.columnId !== overColumn.id) {
        setOptimisticLots(prev =>
          prev.map(lot =>
            lot.id === activeId
              ? { ...lot, columnId: overColumn.id, columnOrder: 0 }
              : lot
          )
        );
      }
      return;
    }

    // Over é outro lot
    const overLot = optimisticLots.find(lot => lot.id === overId);
    if (!overLot) return;

    if (activeLot.columnId !== overLot.columnId) {
      // Movendo entre colunas
      setOptimisticLots(prev => {
        const newLots = prev.map(lot => {
          if (lot.id === activeId) {
            return { ...lot, columnId: overLot.columnId, columnOrder: overLot.columnOrder };
          }
          return lot;
        });
        return newLots;
      });
    }
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;

    setActiveId(null);

    if (!over) return;

    const activeId = active.id as string;
    const overId = over.id as string;

    const activeLot = optimisticLots.find(lot => lot.id === activeId);
    if (!activeLot) return;

    try {
      // Verifica se over é uma coluna
      const overColumn = columns.find(col => col.id === overId);

      if (overColumn) {
        // Movendo para uma coluna (possivelmente vazia)
        const lotsInColumn = getLotsByColumn(overColumn.id);
        const newOrder = lotsInColumn.length;

        await moveLot(activeId, overColumn.id, newOrder);
        return;
      }

      // Over é outro lot
      const overLot = optimisticLots.find(lot => lot.id === overId);
      if (!overLot) return;

      if (activeLot.columnId === overLot.columnId) {
        // Reordenando na mesma coluna
        const columnLots = getLotsByColumn(activeLot.columnId);
        const oldIndex = columnLots.findIndex(lot => lot.id === activeId);
        const newIndex = columnLots.findIndex(lot => lot.id === overId);

        if (oldIndex !== newIndex) {
          const reordered = arrayMove(columnLots, oldIndex, newIndex);
          const lotOrders = reordered.map((lot, index) => ({
            id: lot.id,
            order: index,
          }));

          await reorderLotsInColumn(activeLot.columnId, lotOrders);
        }
      } else {
        // Movendo entre colunas
        const targetColumnLots = getLotsByColumn(overLot.columnId);
        const overIndex = targetColumnLots.findIndex(lot => lot.id === overId);

        await moveLot(activeId, overLot.columnId, overIndex);

        // Reordena a coluna de destino
        const newTargetLots = [
          ...targetColumnLots.slice(0, overIndex),
          activeLot,
          ...targetColumnLots.slice(overIndex),
        ];
        const lotOrders = newTargetLots.map((lot, index) => ({
          id: lot.id,
          order: index,
        }));

        await reorderLotsInColumn(overLot.columnId, lotOrders);
      }
    } catch (error) {
      console.error('Erro ao mover lote:', error);
      toast({
        variant: 'destructive',
        title: 'Erro ao mover',
        description: 'Não foi possível mover o lote. Tente novamente.',
      });
      // Reverte para o estado original
      setOptimisticLots(lots);
    }
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div className="flex gap-4 h-full overflow-x-auto pb-4">
        <SortableContext
          items={columns.map(col => col.id)}
          strategy={horizontalListSortingStrategy}
        >
          {columns.map(column => (
            <KanbanColumn
              key={column.id}
              column={column}
              lots={getLotsByColumn(column.id)}
            />
          ))}
        </SortableContext>
      </div>

      <DragOverlay>
        {activeLot ? (
          <KanbanCard lot={activeLot} isDragging />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
