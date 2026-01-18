'use client';

import * as React from 'react';
import { Loader2 } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Calendar } from '@/components/ui/calendar';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { SelectOrdersModal } from './SelectOrdersModal';
import { createLot } from '@/services/kanban-service';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Calendar as CalendarIcon } from 'lucide-react';
import type { ProductionColumn, LotPriority, CreateLotItemInput } from '@/types/kanban';

interface CreateLotModalProps {
  isOpen: boolean;
  onClose: () => void;
  columns: ProductionColumn[];
}

export function CreateLotModal({ isOpen, onClose, columns }: CreateLotModalProps) {
  const [step, setStep] = React.useState<'items' | 'details'>('items');
  const [selectedItems, setSelectedItems] = React.useState<CreateLotItemInput[]>([]);
  const [title, setTitle] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [priority, setPriority] = React.useState<LotPriority>('normal');
  const [columnId, setColumnId] = React.useState('');
  const [dueDate, setDueDate] = React.useState<Date | undefined>();
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  const { user } = useAuth();
  const { toast } = useToast();

  // Define coluna padrão (primeira coluna - Fila)
  React.useEffect(() => {
    if (columns.length > 0 && !columnId) {
      setColumnId(columns[0].id);
    }
  }, [columns, columnId]);

  const handleItemsSelected = (items: CreateLotItemInput[]) => {
    setSelectedItems(items);
    setStep('details');

    // Gera título automático baseado nos SKUs
    const skus = [...new Set(items.map(i => i.sku))];
    if (skus.length === 1) {
      setTitle(`Lote - ${skus[0]}`);
    } else if (skus.length <= 3) {
      setTitle(`Lote - ${skus.join(', ')}`);
    } else {
      setTitle(`Lote - ${skus.length} SKUs`);
    }
  };

  const handleSubmit = async () => {
    if (!title.trim()) {
      toast({
        variant: 'destructive',
        title: 'Título obrigatório',
        description: 'Por favor, informe um título para o lote.',
      });
      return;
    }

    if (selectedItems.length === 0) {
      toast({
        variant: 'destructive',
        title: 'Nenhum item selecionado',
        description: 'Por favor, selecione pelo menos um item para o lote.',
      });
      return;
    }

    if (!columnId) {
      toast({
        variant: 'destructive',
        title: 'Coluna obrigatória',
        description: 'Por favor, selecione uma coluna para o lote.',
      });
      return;
    }

    setIsSubmitting(true);

    try {
      const result = await createLot({
        title: title.trim(),
        description: description.trim() || undefined,
        columnId,
        priority,
        dueDate: dueDate?.toISOString(),
        items: selectedItems,
        createdBy: {
          userId: user?.id || '',
          userName: user?.name || 'Usuário',
        },
      });

      toast({
        title: 'Lote criado',
        description: `Lote ${result.lotNumber} criado com sucesso.`,
      });

      handleClose();
    } catch (error) {
      console.error('Erro ao criar lote:', error);
      toast({
        variant: 'destructive',
        title: 'Erro ao criar lote',
        description: 'Não foi possível criar o lote. Tente novamente.',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    setStep('items');
    setSelectedItems([]);
    setTitle('');
    setDescription('');
    setPriority('normal');
    setColumnId(columns[0]?.id || '');
    setDueDate(undefined);
    onClose();
  };

  const handleBack = () => {
    setStep('items');
  };

  if (step === 'items') {
    return (
      <SelectOrdersModal
        isOpen={isOpen}
        onClose={handleClose}
        onItemsSelected={handleItemsSelected}
      />
    );
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Criar Lote de Produção</DialogTitle>
          <DialogDescription>
            {selectedItems.length} itens selecionados de{' '}
            {new Set(selectedItems.map(i => i.sourceOrderId)).size} pedidos
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          {/* Título */}
          <div className="grid gap-2">
            <Label htmlFor="title">Título *</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Nome do lote"
            />
          </div>

          {/* Descrição */}
          <div className="grid gap-2">
            <Label htmlFor="description">Descrição</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Observações sobre o lote (opcional)"
              rows={2}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* Coluna */}
            <div className="grid gap-2">
              <Label>Coluna *</Label>
              <Select value={columnId} onValueChange={setColumnId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione..." />
                </SelectTrigger>
                <SelectContent>
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
            </div>

            {/* Prioridade */}
            <div className="grid gap-2">
              <Label>Prioridade</Label>
              <Select value={priority} onValueChange={(v) => setPriority(v as LotPriority)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="baixa">Baixa</SelectItem>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="alta">Alta</SelectItem>
                  <SelectItem value="urgente">Urgente</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Data prevista */}
          <div className="grid gap-2">
            <Label>Data Prevista</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    'justify-start text-left font-normal',
                    !dueDate && 'text-muted-foreground'
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {dueDate
                    ? format(dueDate, 'dd/MM/yyyy', { locale: ptBR })
                    : 'Selecione uma data'}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={dueDate}
                  onSelect={setDueDate}
                  locale={ptBR}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={handleBack}>
            Voltar
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Criar Lote
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
