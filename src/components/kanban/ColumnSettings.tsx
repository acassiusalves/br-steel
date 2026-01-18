'use client';

import * as React from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Loader2, Pencil, Plus, Trash2, X } from 'lucide-react';

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  createColumn,
  updateColumn,
  deleteColumn,
  reorderColumns,
} from '@/services/kanban-service';
import { useToast } from '@/hooks/use-toast';
import type { ProductionColumn, CreateColumnInput } from '@/types/kanban';

interface ColumnSettingsProps {
  isOpen: boolean;
  onClose: () => void;
  columns: ProductionColumn[];
}

const DEFAULT_COLORS = [
  '#6b7280', // gray
  '#ef4444', // red
  '#f97316', // orange
  '#f59e0b', // amber
  '#eab308', // yellow
  '#84cc16', // lime
  '#22c55e', // green
  '#14b8a6', // teal
  '#06b6d4', // cyan
  '#3b82f6', // blue
  '#6366f1', // indigo
  '#8b5cf6', // violet
  '#a855f7', // purple
  '#ec4899', // pink
];

interface SortableColumnItemProps {
  column: ProductionColumn;
  onEdit: (column: ProductionColumn) => void;
  onDelete: (column: ProductionColumn) => void;
}

function SortableColumnItem({ column, onEdit, onDelete }: SortableColumnItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: column.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-3 p-3 bg-background rounded-lg border ${
        isDragging ? 'opacity-50 shadow-lg' : ''
      }`}
    >
      <button
        {...attributes}
        {...listeners}
        className="touch-none text-muted-foreground hover:text-foreground cursor-grab active:cursor-grabbing"
      >
        <GripVertical className="h-4 w-4" />
      </button>

      <div
        className="w-4 h-4 rounded-full shrink-0"
        style={{ backgroundColor: column.color }}
      />

      <span className="flex-1 font-medium text-sm">{column.name}</span>

      <Button variant="ghost" size="sm" onClick={() => onEdit(column)}>
        <Pencil className="h-4 w-4" />
      </Button>

      <Button
        variant="ghost"
        size="sm"
        onClick={() => onDelete(column)}
        className="text-destructive hover:text-destructive"
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
}

export function ColumnSettings({ isOpen, onClose, columns }: ColumnSettingsProps) {
  const [localColumns, setLocalColumns] = React.useState<ProductionColumn[]>(columns);
  const [isAdding, setIsAdding] = React.useState(false);
  const [editingColumn, setEditingColumn] = React.useState<ProductionColumn | null>(null);
  const [deletingColumn, setDeletingColumn] = React.useState<ProductionColumn | null>(null);

  // Form states
  const [name, setName] = React.useState('');
  const [color, setColor] = React.useState(DEFAULT_COLORS[0]);
  const [isSaving, setIsSaving] = React.useState(false);
  const [isDeleting, setIsDeleting] = React.useState(false);

  const { toast } = useToast();

  // Sincroniza com props
  React.useEffect(() => {
    setLocalColumns(columns);
  }, [columns]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;

    if (!over || active.id === over.id) return;

    const oldIndex = localColumns.findIndex(col => col.id === active.id);
    const newIndex = localColumns.findIndex(col => col.id === over.id);

    const reordered = arrayMove(localColumns, oldIndex, newIndex);
    setLocalColumns(reordered);

    try {
      const columnOrders = reordered.map((col, index) => ({
        id: col.id,
        order: index,
      }));
      await reorderColumns(columnOrders);
      toast({ title: 'Ordem das colunas atualizada' });
    } catch (error) {
      console.error('Erro ao reordenar colunas:', error);
      setLocalColumns(columns); // Reverte
      toast({
        variant: 'destructive',
        title: 'Erro',
        description: 'Não foi possível reordenar as colunas.',
      });
    }
  };

  const handleAdd = async () => {
    if (!name.trim()) {
      toast({
        variant: 'destructive',
        title: 'Nome obrigatório',
        description: 'Por favor, informe um nome para a coluna.',
      });
      return;
    }

    setIsSaving(true);
    try {
      await createColumn({
        name: name.trim(),
        order: localColumns.length,
        color,
      });

      toast({ title: 'Coluna criada' });
      resetForm();
    } catch (error) {
      console.error('Erro ao criar coluna:', error);
      toast({
        variant: 'destructive',
        title: 'Erro',
        description: 'Não foi possível criar a coluna.',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleEdit = async () => {
    if (!editingColumn || !name.trim()) return;

    setIsSaving(true);
    try {
      await updateColumn(editingColumn.id, {
        name: name.trim(),
        color,
      });

      toast({ title: 'Coluna atualizada' });
      resetForm();
    } catch (error) {
      console.error('Erro ao atualizar coluna:', error);
      toast({
        variant: 'destructive',
        title: 'Erro',
        description: 'Não foi possível atualizar a coluna.',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deletingColumn) return;

    setIsDeleting(true);
    try {
      await deleteColumn(deletingColumn.id);
      toast({ title: 'Coluna excluída' });
      setDeletingColumn(null);
    } catch (error) {
      console.error('Erro ao excluir coluna:', error);
      const message = error instanceof Error ? error.message : 'Não foi possível excluir a coluna.';
      toast({
        variant: 'destructive',
        title: 'Erro',
        description: message,
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const startEditing = (column: ProductionColumn) => {
    setEditingColumn(column);
    setName(column.name);
    setColor(column.color);
    setIsAdding(false);
  };

  const startAdding = () => {
    setIsAdding(true);
    setEditingColumn(null);
    setName('');
    setColor(DEFAULT_COLORS[0]);
  };

  const resetForm = () => {
    setIsAdding(false);
    setEditingColumn(null);
    setName('');
    setColor(DEFAULT_COLORS[0]);
  };

  return (
    <>
      <Sheet open={isOpen} onOpenChange={onClose}>
        <SheetContent className="sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Configurar Colunas</SheetTitle>
            <SheetDescription>
              Adicione, edite ou reordene as colunas do Kanban.
              Arraste para reordenar.
            </SheetDescription>
          </SheetHeader>

          <div className="mt-6 space-y-4">
            {/* Lista de colunas */}
            <ScrollArea className="h-[300px] pr-4">
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={localColumns.map(col => col.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="space-y-2">
                    {localColumns.map(column => (
                      <SortableColumnItem
                        key={column.id}
                        column={column}
                        onEdit={startEditing}
                        onDelete={setDeletingColumn}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            </ScrollArea>

            <Separator />

            {/* Formulário de adição/edição */}
            {(isAdding || editingColumn) ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="font-medium">
                    {editingColumn ? 'Editar Coluna' : 'Nova Coluna'}
                  </h4>
                  <Button variant="ghost" size="sm" onClick={resetForm}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="column-name">Nome</Label>
                  <Input
                    id="column-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Nome da coluna"
                  />
                </div>

                <div className="space-y-2">
                  <Label>Cor</Label>
                  <div className="flex flex-wrap gap-2">
                    {DEFAULT_COLORS.map(c => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setColor(c)}
                        className={`w-6 h-6 rounded-full border-2 transition-transform ${
                          color === c ? 'border-foreground scale-110' : 'border-transparent'
                        }`}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button
                    onClick={editingColumn ? handleEdit : handleAdd}
                    disabled={isSaving}
                    className="flex-1"
                  >
                    {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {editingColumn ? 'Salvar' : 'Adicionar'}
                  </Button>
                  <Button variant="outline" onClick={resetForm}>
                    Cancelar
                  </Button>
                </div>
              </div>
            ) : (
              <Button onClick={startAdding} variant="outline" className="w-full">
                <Plus className="mr-2 h-4 w-4" />
                Adicionar Coluna
              </Button>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Dialog de confirmação de exclusão */}
      <AlertDialog open={!!deletingColumn} onOpenChange={() => setDeletingColumn(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir coluna?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação não pode ser desfeita. A coluna "{deletingColumn?.name}" será
              permanentemente excluída. Certifique-se de que não há lotes nesta coluna.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
