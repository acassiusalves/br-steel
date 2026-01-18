'use client';

import * as React from 'react';
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Loader2, Wifi, WifiOff } from 'lucide-react';

import DashboardLayout from '@/components/dashboard-layout';
import { KanbanBoard } from '@/components/kanban/KanbanBoard';
import { KanbanHeader } from '@/components/kanban/KanbanHeader';
import { KanbanFilters } from '@/components/kanban/KanbanFilters';
import { useToast } from '@/hooks/use-toast';
import { seedDefaultColumns } from '@/services/kanban-service';
import type { ProductionColumn, ProductionLot, LotPriority } from '@/types/kanban';
import { Badge } from '@/components/ui/badge';

export default function KanbanClient() {
  const [columns, setColumns] = React.useState<ProductionColumn[]>([]);
  const [lots, setLots] = React.useState<ProductionLot[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isConnected, setIsConnected] = React.useState(false);
  const { toast } = useToast();

  // Filtros
  const [searchTerm, setSearchTerm] = React.useState('');
  const [filterColumn, setFilterColumn] = React.useState<string>('all');
  const [filterPriority, setFilterPriority] = React.useState<string>('all');
  const [filterAssigned, setFilterAssigned] = React.useState<string>('all');

  // Inicializa colunas padrão se necessário
  React.useEffect(() => {
    const initColumns = async () => {
      try {
        await seedDefaultColumns();
      } catch (error) {
        console.error('Erro ao inicializar colunas:', error);
      }
    };
    initColumns();
  }, []);

  // Listener real-time para colunas
  React.useEffect(() => {
    const columnsRef = collection(db, 'productionColumns');
    const q = query(columnsRef, orderBy('order', 'asc'));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const columnsData = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data(),
        })) as ProductionColumn[];
        setColumns(columnsData);
        setIsConnected(true);
      },
      (error) => {
        console.error('Erro ao escutar colunas:', error);
        setIsConnected(false);
        toast({
          variant: 'destructive',
          title: 'Erro de conexão',
          description: 'Não foi possível conectar ao banco de dados.',
        });
      }
    );

    return () => unsubscribe();
  }, [toast]);

  // Listener real-time para lotes
  React.useEffect(() => {
    const lotsRef = collection(db, 'productionLots');
    const q = query(lotsRef, orderBy('columnOrder', 'asc'));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const lotsData = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data(),
        })) as ProductionLot[];
        setLots(lotsData);
        setIsLoading(false);
      },
      (error) => {
        console.error('Erro ao escutar lotes:', error);
        setIsLoading(false);
        toast({
          variant: 'destructive',
          title: 'Erro ao carregar lotes',
          description: 'Não foi possível carregar os lotes de produção.',
        });
      }
    );

    return () => unsubscribe();
  }, [toast]);

  // Filtragem dos lotes
  const filteredLots = React.useMemo(() => {
    return lots.filter(lot => {
      // Filtro de busca
      if (searchTerm) {
        const search = searchTerm.toLowerCase();
        const matchesSearch =
          lot.lotNumber.toLowerCase().includes(search) ||
          lot.title.toLowerCase().includes(search);
        if (!matchesSearch) return false;
      }

      // Filtro de coluna
      if (filterColumn !== 'all' && lot.columnId !== filterColumn) {
        return false;
      }

      // Filtro de prioridade
      if (filterPriority !== 'all' && lot.priority !== filterPriority) {
        return false;
      }

      // Filtro de responsável
      if (filterAssigned !== 'all') {
        if (filterAssigned === 'unassigned' && lot.assignedTo) {
          return false;
        }
        if (filterAssigned !== 'unassigned' && lot.assignedTo?.userId !== filterAssigned) {
          return false;
        }
      }

      return true;
    });
  }, [lots, searchTerm, filterColumn, filterPriority, filterAssigned]);

  // Obtém lista única de usuários atribuídos para o filtro
  const assignedUsers = React.useMemo(() => {
    const users = new Map<string, string>();
    lots.forEach(lot => {
      if (lot.assignedTo) {
        users.set(lot.assignedTo.userId, lot.assignedTo.userName);
      }
    });
    return Array.from(users, ([id, name]) => ({ id, name }));
  }, [lots]);

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-[calc(100vh-200px)]">
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-muted-foreground">Carregando Kanban...</p>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <KanbanHeader columns={columns} />
          <Badge
            variant={isConnected ? 'default' : 'destructive'}
            className="flex items-center gap-1"
          >
            {isConnected ? (
              <>
                <Wifi className="h-3 w-3" />
                Conectado
              </>
            ) : (
              <>
                <WifiOff className="h-3 w-3" />
                Desconectado
              </>
            )}
          </Badge>
        </div>

        {/* Filtros */}
        <KanbanFilters
          searchTerm={searchTerm}
          onSearchChange={setSearchTerm}
          filterColumn={filterColumn}
          onColumnChange={setFilterColumn}
          filterPriority={filterPriority}
          onPriorityChange={setFilterPriority}
          filterAssigned={filterAssigned}
          onAssignedChange={setFilterAssigned}
          columns={columns}
          assignedUsers={assignedUsers}
        />

        {/* Board */}
        <div className="flex-1 overflow-hidden mt-4">
          <KanbanBoard
            columns={columns}
            lots={filteredLots}
          />
        </div>
      </div>
    </DashboardLayout>
  );
}
