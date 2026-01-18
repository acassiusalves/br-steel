'use client';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { PRIORITY_COLORS, PRIORITY_LABELS, type LotPriority } from '@/types/kanban';

interface PriorityBadgeProps {
  priority: LotPriority;
  size?: 'sm' | 'default';
  className?: string;
}

export function PriorityBadge({ priority, size = 'default', className }: PriorityBadgeProps) {
  const colors = PRIORITY_COLORS[priority];
  const label = PRIORITY_LABELS[priority];

  return (
    <Badge
      variant="outline"
      className={cn(
        colors.bg,
        colors.text,
        colors.border,
        size === 'sm' && 'text-[10px] px-1.5 py-0',
        className
      )}
    >
      {label}
    </Badge>
  );
}
