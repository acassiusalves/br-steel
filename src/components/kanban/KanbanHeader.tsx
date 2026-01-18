'use client';

import * as React from 'react';
import { Plus, Settings } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { CreateLotModal } from './CreateLotModal';
import { ColumnSettings } from './ColumnSettings';
import { useAuth } from '@/contexts/AuthContext';
import type { ProductionColumn } from '@/types/kanban';

interface KanbanHeaderProps {
  columns: ProductionColumn[];
}

export function KanbanHeader({ columns }: KanbanHeaderProps) {
  const [isCreateModalOpen, setIsCreateModalOpen] = React.useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = React.useState(false);
  const { user } = useAuth();

  const isAdmin = user?.role === 'Administrador';

  return (
    <div className="flex items-center gap-4">
      <div>
        <h1 className="text-2xl font-bold">Kanban de Produção</h1>
        <p className="text-sm text-muted-foreground">
          Gerencie os lotes de produção
        </p>
      </div>

      <div className="flex items-center gap-2 ml-auto">
        {isAdmin && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsSettingsOpen(true)}
          >
            <Settings className="h-4 w-4 mr-2" />
            Configurar Colunas
          </Button>
        )}

        <Button size="sm" onClick={() => setIsCreateModalOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Criar Lote
        </Button>
      </div>

      <CreateLotModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        columns={columns}
      />

      {isAdmin && (
        <ColumnSettings
          isOpen={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
          columns={columns}
        />
      )}
    </div>
  );
}
