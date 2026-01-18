'use client';

import * as React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  Calendar,
  GripVertical,
  MessageSquare,
  Package,
  User,
} from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { PriorityBadge } from './PriorityBadge';
import { KanbanCardDetail } from './KanbanCardDetail';
import { cn } from '@/lib/utils';
import type { ProductionLot } from '@/types/kanban';

interface KanbanCardProps {
  lot: ProductionLot;
  isDragging?: boolean;
}

export function KanbanCard({ lot, isDragging = false }: KanbanCardProps) {
  const [isDetailOpen, setIsDetailOpen] = React.useState(false);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging: isSortableDragging,
  } = useSortable({ id: lot.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const handleCardClick = (e: React.MouseEvent) => {
    // Evita abrir o modal se estiver arrastando
    if (isSortableDragging) return;
    setIsDetailOpen(true);
  };

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  return (
    <>
      <Card
        ref={setNodeRef}
        style={style}
        className={cn(
          'cursor-pointer hover:shadow-md transition-shadow',
          (isDragging || isSortableDragging) && 'opacity-50 shadow-lg rotate-2',
          isDragging && 'shadow-2xl'
        )}
        onClick={handleCardClick}
      >
        <CardContent className="p-3">
          {/* Header com grip e número do lote */}
          <div className="flex items-start justify-between gap-2 mb-2">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <button
                {...attributes}
                {...listeners}
                className="touch-none text-muted-foreground hover:text-foreground cursor-grab active:cursor-grabbing"
                onClick={(e) => e.stopPropagation()}
              >
                <GripVertical className="h-4 w-4" />
              </button>
              <span className="text-xs text-muted-foreground font-mono">
                {lot.lotNumber}
              </span>
            </div>
            <PriorityBadge priority={lot.priority} size="sm" />
          </div>

          {/* Título */}
          <h4 className="font-medium text-sm mb-2 line-clamp-2">
            {lot.title}
          </h4>

          {/* Info badges */}
          <div className="flex flex-wrap gap-1 mb-2">
            <Badge variant="outline" className="text-xs">
              <Package className="h-3 w-3 mr-1" />
              {lot.totalItems} itens
            </Badge>
            <Badge variant="outline" className="text-xs">
              {lot.totalSkus} SKUs
            </Badge>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between mt-2 pt-2 border-t">
            {/* Responsável */}
            {lot.assignedTo ? (
              <div className="flex items-center gap-1">
                <Avatar className="h-5 w-5">
                  <AvatarFallback className="text-[10px]">
                    {getInitials(lot.assignedTo.userName)}
                  </AvatarFallback>
                </Avatar>
                <span className="text-xs text-muted-foreground truncate max-w-[80px]">
                  {lot.assignedTo.userName.split(' ')[0]}
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-1 text-muted-foreground">
                <User className="h-4 w-4" />
                <span className="text-xs">Sem responsável</span>
              </div>
            )}

            {/* Data prevista */}
            {lot.dueDate && (
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Calendar className="h-3 w-3" />
                {format(new Date(lot.dueDate), 'dd/MM', { locale: ptBR })}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Modal de detalhes */}
      <KanbanCardDetail
        lot={lot}
        isOpen={isDetailOpen}
        onClose={() => setIsDetailOpen(false)}
      />
    </>
  );
}
