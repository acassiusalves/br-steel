'use client';

import * as React from 'react';
import { Loader2, Sparkles } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import type { GroupProductsOutput } from '@/ai/flows/group-products';

/** Per-SKU info we show in the modal so the user can judge each suggestion. */
export interface ReviewSkuInfo {
  sku: string;
  description: string;
  revenue: number;
}

/**
 * What the modal sends back when the user clicks "Salvar".
 * `canonicalName` is the (possibly edited) name and `skus` is the filtered
 * list of SKUs the user kept checked.
 */
export interface ApprovedGroup {
  canonicalName: string;
  skus: string[];
  reason?: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  suggestions: GroupProductsOutput['groups'];
  skuInfo: Map<string, ReviewSkuInfo>;
  isSaving: boolean;
  onConfirm: (approved: ApprovedGroup[]) => void | Promise<void>;
}

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(
    value || 0
  );

/**
 * Reviews the groups suggested by Gemini before saving them to Firestore.
 * The user can:
 *   - edit the canonical name of each group
 *   - uncheck individual SKUs they don't want in a group
 *   - reject a whole group (uncheck the "Aceitar" switch at the top)
 */
export default function AbcGroupReviewModal({
  open,
  onOpenChange,
  suggestions,
  skuInfo,
  isSaving,
  onConfirm,
}: Props) {
  // Working state — independent from the suggestions prop so edits don't
  // mutate the parent. Re-initialized every time the modal opens with fresh
  // suggestions.
  const [names, setNames] = React.useState<Record<number, string>>({});
  const [accepted, setAccepted] = React.useState<Record<number, boolean>>({});
  const [skuChecked, setSkuChecked] = React.useState<Record<string, boolean>>(
    {}
  );

  React.useEffect(() => {
    if (!open) return;
    const initialNames: Record<number, string> = {};
    const initialAccepted: Record<number, boolean> = {};
    const initialSkus: Record<string, boolean> = {};
    suggestions.forEach((group, idx) => {
      initialNames[idx] = group.canonicalName;
      initialAccepted[idx] = true;
      group.skus.forEach((sku) => {
        initialSkus[`${idx}:${sku}`] = true;
      });
    });
    setNames(initialNames);
    setAccepted(initialAccepted);
    setSkuChecked(initialSkus);
  }, [open, suggestions]);

  const toggleGroup = (idx: number) => {
    setAccepted((prev) => ({ ...prev, [idx]: !prev[idx] }));
  };

  const toggleSku = (idx: number, sku: string) => {
    const key = `${idx}:${sku}`;
    setSkuChecked((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const buildApproved = (): ApprovedGroup[] => {
    const result: ApprovedGroup[] = [];
    suggestions.forEach((group, idx) => {
      if (!accepted[idx]) return;
      const keptSkus = group.skus.filter(
        (sku) => skuChecked[`${idx}:${sku}`]
      );
      if (keptSkus.length < 2) return;
      const canonicalName = (names[idx] || group.canonicalName).trim();
      if (!canonicalName) return;
      result.push({
        canonicalName,
        skus: keptSkus,
        reason: group.reason,
      });
    });
    return result;
  };

  const approved = buildApproved();
  const totalGroups = suggestions.length;
  const totalApprovedGroups = approved.length;
  const totalApprovedSkus = approved.reduce((sum, g) => sum + g.skus.length, 0);

  const handleConfirm = async () => {
    if (!approved.length) return;
    await onConfirm(approved);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Revisar grupos sugeridos pela IA
          </DialogTitle>
          <DialogDescription>
            O Gemini identificou produtos que podem ser o mesmo item físico.
            Revise cada grupo, ajuste o nome canônico e desmarque o que não
            deveria estar junto. Apenas grupos com 2+ SKUs marcados serão
            salvos.
          </DialogDescription>
        </DialogHeader>

        {suggestions.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            O Gemini não encontrou nenhum agrupamento com confiança suficiente
            neste conjunto de produtos.
          </div>
        ) : (
          <ScrollArea className="max-h-[60vh] pr-3">
            <div className="space-y-4">
              {suggestions.map((group, idx) => {
                const isAccepted = accepted[idx];
                const groupRevenue = group.skus.reduce(
                  (sum, sku) =>
                    sum +
                    (skuChecked[`${idx}:${sku}`]
                      ? skuInfo.get(sku)?.revenue ?? 0
                      : 0),
                  0
                );
                return (
                  <div
                    key={idx}
                    className={cn(
                      'rounded-lg border p-3 transition-opacity',
                      !isAccepted && 'opacity-50'
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <Checkbox
                        checked={isAccepted}
                        onCheckedChange={() => toggleGroup(idx)}
                        className="mt-2"
                        aria-label="Aceitar grupo"
                      />
                      <div className="flex-1 space-y-2">
                        <div>
                          <label className="text-xs font-semibold uppercase text-muted-foreground">
                            Nome canônico
                          </label>
                          <Input
                            value={names[idx] ?? ''}
                            onChange={(e) =>
                              setNames((prev) => ({
                                ...prev,
                                [idx]: e.target.value,
                              }))
                            }
                            disabled={!isAccepted}
                            className="mt-1"
                          />
                        </div>
                        {group.reason ? (
                          <p className="text-xs italic text-muted-foreground">
                            Motivo: {group.reason}
                          </p>
                        ) : null}
                        <Separator />
                        <div className="space-y-1">
                          {group.skus.map((sku) => {
                            const info = skuInfo.get(sku);
                            const checked = !!skuChecked[`${idx}:${sku}`];
                            return (
                              <label
                                key={sku}
                                className={cn(
                                  'flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/50',
                                  !isAccepted && 'pointer-events-none'
                                )}
                              >
                                <Checkbox
                                  checked={checked}
                                  onCheckedChange={() => toggleSku(idx, sku)}
                                  className="mt-1"
                                  aria-label={`Manter SKU ${sku}`}
                                />
                                <div className="flex-1">
                                  <div className="font-mono text-xs text-muted-foreground">
                                    {sku}
                                  </div>
                                  <div className="break-words">
                                    {info?.description ?? '(descrição indisponível)'}
                                  </div>
                                </div>
                                {info ? (
                                  <div className="whitespace-nowrap text-xs text-muted-foreground">
                                    {formatCurrency(info.revenue)}
                                  </div>
                                ) : null}
                              </label>
                            );
                          })}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Subtotal do grupo:{' '}
                          <span className="font-semibold">
                            {formatCurrency(groupRevenue)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        )}

        <DialogFooter className="flex items-center justify-between gap-4 sm:justify-between">
          <div className="text-xs text-muted-foreground">
            {totalApprovedGroups} de {totalGroups} grupos selecionados •{' '}
            {totalApprovedSkus} SKUs
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSaving}
            >
              Cancelar
            </Button>
            <Button
              onClick={handleConfirm}
              disabled={isSaving || totalApprovedGroups === 0}
            >
              {isSaving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Salvando...
                </>
              ) : (
                `Salvar ${totalApprovedGroups} grupo${
                  totalApprovedGroups === 1 ? '' : 's'
                }`
              )}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
