'use client';

import * as React from 'react';
import { subscribeOperation } from '@/lib/operation-client';
import { getProductionOrders } from '@/services/kanban-service';
import { Loader2, Search, Package } from 'lucide-react';

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
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';

import type { CreateLotItemInput } from '@/types/kanban';

interface SelectOrdersModalProps {
  isOpen: boolean;
  onClose: () => void;
  onItemsSelected: (items: CreateLotItemInput[]) => void;
}

interface OrderItem {
  orderId: string;
  orderNumber: number;
  customerName: string;
  itemId: number;
  sku: string;
  productName: string;
  quantity: number;
  unit: string;
}

export function SelectOrdersModal({
  isOpen,
  onClose,
  onItemsSelected,
}: SelectOrdersModalProps) {
  const [items, setItems] = React.useState<OrderItem[]>([]);
  const [selectedItems, setSelectedItems] = React.useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = React.useState(false);
  const [searchTerm, setSearchTerm] = React.useState('');
  const { toast } = useToast();

  React.useEffect(() => {
    if (!isOpen) return;
    setIsLoading(true);
    return subscribeOperation(getProductionOrders, orders => {
      setItems(orders.flatMap(order => order.itens.map(item => ({
        orderId: order.id,
        orderNumber: order.numero,
        customerName: '',
        itemId: item.id,
        sku: item.codigo || 'SEM-SKU',
        productName: item.descricao || 'Produto sem descrição',
        quantity: item.quantidade,
        unit: item.unidade || 'UN',
      }))));
      setIsLoading(false);
    }, error => {
      setItems([]); setIsLoading(false);
      toast({ variant: 'destructive', title: 'Erro ao carregar pedidos', description: error.message });
    });
  }, [isOpen, toast]);

  // Filtra itens pela busca
  const filteredItems = React.useMemo(() => {
    if (!searchTerm) return items;

    const search = searchTerm.toLowerCase();
    return items.filter(
      item =>
        item.sku.toLowerCase().includes(search) ||
        item.productName.toLowerCase().includes(search) ||
        item.orderNumber.toString().includes(search)
    );
  }, [items, searchTerm]);

  // Agrupa itens por SKU para exibição
  const groupedBySku = React.useMemo(() => {
    const groups = new Map<string, OrderItem[]>();
    filteredItems.forEach(item => {
      const existing = groups.get(item.sku) || [];
      existing.push(item);
      groups.set(item.sku, existing);
    });
    return groups;
  }, [filteredItems]);

  const getItemKey = (item: OrderItem) => `${item.orderId}-${item.itemId}`;

  const toggleItem = (item: OrderItem) => {
    const key = getItemKey(item);
    setSelectedItems(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const toggleAllBySku = (sku: string, skuItems: OrderItem[]) => {
    const allSelected = skuItems.every(item => selectedItems.has(getItemKey(item)));

    setSelectedItems(prev => {
      const next = new Set(prev);
      skuItems.forEach(item => {
        const key = getItemKey(item);
        if (allSelected) {
          next.delete(key);
        } else {
          next.add(key);
        }
      });
      return next;
    });
  };

  const handleConfirm = () => {
    const selectedItemsList: CreateLotItemInput[] = [];

    items.forEach(item => {
      if (selectedItems.has(getItemKey(item))) {
        selectedItemsList.push({
          sku: item.sku,
          productName: item.productName,
          quantity: item.quantity,
          unit: item.unit,
          sourceOrderId: item.orderId,
          sourceOrderNumber: item.orderNumber.toString(),
          customerName: item.customerName,
        });
      }
    });

    onItemsSelected(selectedItemsList);
  };

  const handleClose = () => {
    setSelectedItems(new Set());
    setSearchTerm('');
    onClose();
  };

  const selectedCount = selectedItems.size;
  const totalQuantity = items
    .filter(item => selectedItems.has(getItemKey(item)))
    .reduce((sum, item) => sum + item.quantity, 0);

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[800px] max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>Selecionar Itens para o Lote</DialogTitle>
          <DialogDescription>
            Selecione os itens dos pedidos que farão parte do lote de produção.
            Itens do mesmo SKU serão agrupados.
          </DialogDescription>
        </DialogHeader>

        {/* Barra de busca */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por SKU, produto ou pedido..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Lista de itens */}
        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
            <Package className="h-12 w-12 mb-4" />
            <p>Nenhum item encontrado</p>
            {searchTerm && (
              <Button
                variant="link"
                onClick={() => setSearchTerm('')}
                className="mt-2"
              >
                Limpar busca
              </Button>
            )}
          </div>
        ) : (
          <ScrollArea className="h-[400px] pr-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[50px]"></TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead>Produto</TableHead>
                  <TableHead>Pedido</TableHead>
                  <TableHead className="text-right">Qtd</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Array.from(groupedBySku.entries()).map(([sku, skuItems]) => (
                  <React.Fragment key={sku}>
                    {/* Linha de cabeçalho do SKU */}
                    <TableRow className="bg-muted/50">
                      <TableCell>
                        <Checkbox
                          checked={skuItems.every(item =>
                            selectedItems.has(getItemKey(item))
                          )}
                          onCheckedChange={() => toggleAllBySku(sku, skuItems)}
                        />
                      </TableCell>
                      <TableCell colSpan={3}>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline">{sku}</Badge>
                          <span className="text-sm text-muted-foreground">
                            {skuItems.length} {skuItems.length === 1 ? 'item' : 'itens'} -{' '}
                            {skuItems.reduce((sum, i) => sum + i.quantity, 0)} unidades
                          </span>
                        </div>
                      </TableCell>
                      <TableCell></TableCell>
                    </TableRow>

                    {/* Linhas de itens */}
                    {skuItems.map(item => (
                      <TableRow key={getItemKey(item)}>
                        <TableCell>
                          <Checkbox
                            checked={selectedItems.has(getItemKey(item))}
                            onCheckedChange={() => toggleItem(item)}
                          />
                        </TableCell>
                        <TableCell className="text-muted-foreground text-xs">
                          {item.sku}
                        </TableCell>
                        <TableCell className="max-w-[200px] truncate">
                          {item.productName}
                        </TableCell>
                        <TableCell>#{item.orderNumber}</TableCell>
                        <TableCell className="text-right">
                          {item.quantity} {item.unit}
                        </TableCell>
                      </TableRow>
                    ))}
                  </React.Fragment>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
        )}

        <DialogFooter className="flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            {selectedCount > 0 && (
              <>
                {selectedCount} {selectedCount === 1 ? 'item' : 'itens'} selecionados
                ({totalQuantity} unidades)
              </>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleClose}>
              Cancelar
            </Button>
            <Button onClick={handleConfirm} disabled={selectedCount === 0}>
              Continuar ({selectedCount})
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
