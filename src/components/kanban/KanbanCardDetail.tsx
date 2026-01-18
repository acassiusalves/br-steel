'use client';

import * as React from 'react';
import { collection, getDocs, query, where, onSnapshot, orderBy } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  Calendar as CalendarIcon,
  Edit2,
  Loader2,
  Package,
  Trash2,
  User,
} from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { PriorityBadge } from './PriorityBadge';
import { CommentsList } from './CommentsList';
import { AssignUserPopover } from './AssignUserPopover';
import { updateLot, deleteLot, getLotItems } from '@/services/kanban-service';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import type {
  ProductionLot,
  ProductionLotItem,
  LotPriority,
  AssignedUser,
} from '@/types/kanban';
import { PRIORITY_LABELS } from '@/types/kanban';

interface KanbanCardDetailProps {
  lot: ProductionLot;
  isOpen: boolean;
  onClose: () => void;
}

export function KanbanCardDetail({ lot, isOpen, onClose }: KanbanCardDetailProps) {
  const [isEditing, setIsEditing] = React.useState(false);
  const [title, setTitle] = React.useState(lot.title);
  const [description, setDescription] = React.useState(lot.description || '');
  const [priority, setPriority] = React.useState<LotPriority>(lot.priority);
  const [dueDate, setDueDate] = React.useState<Date | undefined>(
    lot.dueDate ? new Date(lot.dueDate) : undefined
  );
  const [assignedTo, setAssignedTo] = React.useState<AssignedUser | null>(
    lot.assignedTo || null
  );
  const [items, setItems] = React.useState<ProductionLotItem[]>([]);
  const [isLoadingItems, setIsLoadingItems] = React.useState(true);
  const [isSaving, setIsSaving] = React.useState(false);
  const [isDeleting, setIsDeleting] = React.useState(false);

  const { toast } = useToast();
  const { user } = useAuth();

  // Carrega itens do lote
  React.useEffect(() => {
    if (isOpen) {
      loadItems();
    }
  }, [isOpen, lot.id]);

  // Sincroniza estados quando lot muda
  React.useEffect(() => {
    setTitle(lot.title);
    setDescription(lot.description || '');
    setPriority(lot.priority);
    setDueDate(lot.dueDate ? new Date(lot.dueDate) : undefined);
    setAssignedTo(lot.assignedTo || null);
  }, [lot]);

  const loadItems = async () => {
    setIsLoadingItems(true);
    try {
      const itemsData = await getLotItems(lot.id);
      setItems(itemsData);
    } catch (error) {
      console.error('Erro ao carregar itens:', error);
      toast({
        variant: 'destructive',
        title: 'Erro ao carregar itens',
        description: 'Não foi possível carregar os itens do lote.',
      });
    } finally {
      setIsLoadingItems(false);
    }
  };

  const handleSave = async () => {
    if (!title.trim()) {
      toast({
        variant: 'destructive',
        title: 'Título obrigatório',
        description: 'Por favor, informe um título para o lote.',
      });
      return;
    }

    setIsSaving(true);
    try {
      await updateLot(lot.id, {
        title: title.trim(),
        description: description.trim() || undefined,
        priority,
        dueDate: dueDate?.toISOString(),
        assignedTo,
      });

      toast({
        title: 'Lote atualizado',
        description: 'As alterações foram salvas com sucesso.',
      });
      setIsEditing(false);
    } catch (error) {
      console.error('Erro ao atualizar lote:', error);
      toast({
        variant: 'destructive',
        title: 'Erro ao atualizar',
        description: 'Não foi possível salvar as alterações.',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      await deleteLot(lot.id);
      toast({
        title: 'Lote excluído',
        description: `O lote ${lot.lotNumber} foi excluído.`,
      });
      onClose();
    } catch (error) {
      console.error('Erro ao excluir lote:', error);
      toast({
        variant: 'destructive',
        title: 'Erro ao excluir',
        description: 'Não foi possível excluir o lote.',
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const handleAssignUser = async (user: AssignedUser | null) => {
    setAssignedTo(user);
    try {
      await updateLot(lot.id, { assignedTo: user });
      toast({
        title: user ? 'Responsável atribuído' : 'Responsável removido',
      });
    } catch (error) {
      console.error('Erro ao atribuir responsável:', error);
      toast({
        variant: 'destructive',
        title: 'Erro',
        description: 'Não foi possível atualizar o responsável.',
      });
    }
  };

  const handlePriorityChange = async (newPriority: LotPriority) => {
    setPriority(newPriority);
    try {
      await updateLot(lot.id, { priority: newPriority });
      toast({ title: 'Prioridade atualizada' });
    } catch (error) {
      console.error('Erro ao atualizar prioridade:', error);
      toast({
        variant: 'destructive',
        title: 'Erro',
        description: 'Não foi possível atualizar a prioridade.',
      });
    }
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
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[85vh]">
        <DialogHeader>
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="font-mono">
                {lot.lotNumber}
              </Badge>
              <PriorityBadge priority={priority} />
            </div>
            <div className="flex items-center gap-2">
              {!isEditing && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsEditing(true)}
                >
                  <Edit2 className="h-4 w-4 mr-1" />
                  Editar
                </Button>
              )}
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="ghost" size="sm" className="text-destructive">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Excluir lote?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Esta ação não pode ser desfeita. O lote {lot.lotNumber} e
                      todos os seus dados serão permanentemente excluídos.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={handleDelete}
                      disabled={isDeleting}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      {isDeleting && (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      )}
                      Excluir
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>

          {isEditing ? (
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="text-lg font-semibold mt-2"
            />
          ) : (
            <DialogTitle className="mt-2">{lot.title}</DialogTitle>
          )}

          <DialogDescription>
            Criado em {format(new Date(lot.createdAt), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
            {lot.createdBy && ` por ${lot.createdBy.userName}`}
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="detalhes" className="mt-4">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="detalhes">Detalhes</TabsTrigger>
            <TabsTrigger value="itens">
              Itens ({items.length})
            </TabsTrigger>
            <TabsTrigger value="atividade">Atividade</TabsTrigger>
          </TabsList>

          <ScrollArea className="h-[50vh] mt-4">
            {/* Tab Detalhes */}
            <TabsContent value="detalhes" className="pr-4">
              <Card className="border-none shadow-none">
                <CardContent className="space-y-4 pt-4">
                  {/* Descrição */}
                  <div className="space-y-2">
                    <Label>Descrição</Label>
                    {isEditing ? (
                      <Textarea
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder="Adicione uma descrição..."
                        rows={3}
                      />
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        {lot.description || 'Nenhuma descrição'}
                      </p>
                    )}
                  </div>

                  <Separator />

                  <div className="grid grid-cols-2 gap-4">
                    {/* Prioridade */}
                    <div className="space-y-2">
                      <Label>Prioridade</Label>
                      <Select
                        value={priority}
                        onValueChange={(v) => handlePriorityChange(v as LotPriority)}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
                            <SelectItem key={value} value={value}>
                              {label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Data Prevista */}
                    <div className="space-y-2">
                      <Label>Data Prevista</Label>
                      {isEditing ? (
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button
                              variant="outline"
                              className={cn(
                                'w-full justify-start text-left font-normal',
                                !dueDate && 'text-muted-foreground'
                              )}
                            >
                              <CalendarIcon className="mr-2 h-4 w-4" />
                              {dueDate
                                ? format(dueDate, 'dd/MM/yyyy', { locale: ptBR })
                                : 'Selecione...'}
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
                      ) : (
                        <p className="text-sm">
                          {lot.dueDate
                            ? format(new Date(lot.dueDate), 'dd/MM/yyyy', { locale: ptBR })
                            : 'Não definida'}
                        </p>
                      )}
                    </div>
                  </div>

                  <Separator />

                  {/* Responsável */}
                  <div className="space-y-2">
                    <Label>Responsável</Label>
                    <AssignUserPopover
                      currentUser={assignedTo}
                      onAssign={handleAssignUser}
                    />
                  </div>

                  <Separator />

                  {/* Estatísticas */}
                  <div className="grid grid-cols-3 gap-4">
                    <Card>
                      <CardContent className="p-4 text-center">
                        <p className="text-2xl font-bold">{lot.totalItems}</p>
                        <p className="text-xs text-muted-foreground">Itens</p>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="p-4 text-center">
                        <p className="text-2xl font-bold">{lot.totalSkus}</p>
                        <p className="text-xs text-muted-foreground">SKUs</p>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="p-4 text-center">
                        <p className="text-2xl font-bold">{lot.linkedOrderIds?.length || 0}</p>
                        <p className="text-xs text-muted-foreground">Pedidos</p>
                      </CardContent>
                    </Card>
                  </div>

                  {/* Botões de edição */}
                  {isEditing && (
                    <div className="flex justify-end gap-2 pt-4">
                      <Button
                        variant="outline"
                        onClick={() => {
                          setIsEditing(false);
                          setTitle(lot.title);
                          setDescription(lot.description || '');
                        }}
                      >
                        Cancelar
                      </Button>
                      <Button onClick={handleSave} disabled={isSaving}>
                        {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Salvar
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Tab Itens */}
            <TabsContent value="itens" className="pr-4">
              <Card className="border-none shadow-none">
                <CardContent className="pt-4">
                  {isLoadingItems ? (
                    <div className="flex items-center justify-center h-32">
                      <Loader2 className="h-6 w-6 animate-spin text-primary" />
                    </div>
                  ) : items.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
                      <Package className="h-8 w-8 mb-2" />
                      <p>Nenhum item neste lote</p>
                    </div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>SKU</TableHead>
                          <TableHead>Produto</TableHead>
                          <TableHead>Pedido</TableHead>
                          <TableHead>Cliente</TableHead>
                          <TableHead className="text-right">Qtd</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {items.map(item => (
                          <TableRow key={item.id}>
                            <TableCell className="font-mono text-xs">
                              {item.sku}
                            </TableCell>
                            <TableCell className="max-w-[200px] truncate">
                              {item.productName}
                            </TableCell>
                            <TableCell>#{item.sourceOrderNumber}</TableCell>
                            <TableCell className="max-w-[150px] truncate">
                              {item.customerName}
                            </TableCell>
                            <TableCell className="text-right">
                              {item.quantity} {item.unit}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Tab Atividade */}
            <TabsContent value="atividade" className="pr-4">
              <CommentsList lotId={lot.id} />
            </TabsContent>
          </ScrollArea>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
