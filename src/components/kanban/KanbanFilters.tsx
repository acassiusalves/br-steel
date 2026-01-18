'use client';

import * as React from 'react';
import { Search, X } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PRIORITY_LABELS, type ProductionColumn } from '@/types/kanban';

interface KanbanFiltersProps {
  searchTerm: string;
  onSearchChange: (value: string) => void;
  filterColumn: string;
  onColumnChange: (value: string) => void;
  filterPriority: string;
  onPriorityChange: (value: string) => void;
  filterAssigned: string;
  onAssignedChange: (value: string) => void;
  columns: ProductionColumn[];
  assignedUsers: { id: string; name: string }[];
}

export function KanbanFilters({
  searchTerm,
  onSearchChange,
  filterColumn,
  onColumnChange,
  filterPriority,
  onPriorityChange,
  filterAssigned,
  onAssignedChange,
  columns,
  assignedUsers,
}: KanbanFiltersProps) {
  const hasFilters =
    searchTerm ||
    filterColumn !== 'all' ||
    filterPriority !== 'all' ||
    filterAssigned !== 'all';

  const clearFilters = () => {
    onSearchChange('');
    onColumnChange('all');
    onPriorityChange('all');
    onAssignedChange('all');
  };

  return (
    <div className="flex flex-wrap items-center gap-3 p-3 bg-muted/30 rounded-lg">
      {/* Busca */}
      <div className="relative flex-1 min-w-[200px] max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Buscar por número ou título..."
          value={searchTerm}
          onChange={(e) => onSearchChange(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Filtro de coluna */}
      <Select value={filterColumn} onValueChange={onColumnChange}>
        <SelectTrigger className="w-[150px]">
          <SelectValue placeholder="Coluna" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Todas colunas</SelectItem>
          {columns.map(col => (
            <SelectItem key={col.id} value={col.id}>
              <div className="flex items-center gap-2">
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: col.color }}
                />
                {col.name}
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Filtro de prioridade */}
      <Select value={filterPriority} onValueChange={onPriorityChange}>
        <SelectTrigger className="w-[150px]">
          <SelectValue placeholder="Prioridade" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Todas prioridades</SelectItem>
          {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
            <SelectItem key={value} value={value}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Filtro de responsável */}
      <Select value={filterAssigned} onValueChange={onAssignedChange}>
        <SelectTrigger className="w-[180px]">
          <SelectValue placeholder="Responsável" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Todos responsáveis</SelectItem>
          <SelectItem value="unassigned">Sem responsável</SelectItem>
          {assignedUsers.map(user => (
            <SelectItem key={user.id} value={user.id}>
              {user.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Botão limpar filtros */}
      {hasFilters && (
        <Button
          variant="ghost"
          size="sm"
          onClick={clearFilters}
          className="text-muted-foreground"
        >
          <X className="h-4 w-4 mr-1" />
          Limpar
        </Button>
      )}
    </div>
  );
}
