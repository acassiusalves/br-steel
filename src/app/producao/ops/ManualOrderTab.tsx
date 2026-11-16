'use client';

import * as React from 'react';
import { Loader2, Plus } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { OrderKind } from '@/lib/pcp/op-generator';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import * as svc from '@/services/production-orders-service';
import type { ProducibleProduct } from '@/server/persistence/pcp-orders-contract';

const KIND_LABEL: Record<OrderKind, string> = { semanal: 'Produção semanal (dobra)', corte: 'Corte' };
const opNumber = (n: number) => String(n).padStart(7, '0');

/** OP avulsa: um produto com ficha técnica, fora da fila de reposição. */
export default function ManualOrderTab({ onCreated }: { onCreated: () => void }) {
  const { toast } = useToast();
  const [products, setProducts] = React.useState<ProducibleProduct[] | null>(null);
  const [search, setSearch] = React.useState('');
  const [product, setProduct] = React.useState<ProducibleProduct | null>(null);
  const [kind, setKind] = React.useState<OrderKind>('semanal');
  const [quantity, setQuantity] = React.useState('');
  const [urgent, setUrgent] = React.useState(false);
  const [notes, setNotes] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    svc.getProducible().then(setProducts)
      .catch(e => toast({ variant: 'destructive', title: 'Não foi possível carregar os produtos', description: e instanceof Error ? e.message : undefined }));
  }, [toast]);

  const term = search.trim().toLowerCase();
  const matches = term ? (products ?? []).filter(p => p.sku.toLowerCase().includes(term) || p.name.toLowerCase().includes(term)).slice(0, 20) : [];
  const amount = Number(quantity.replace(',', '.'));
  const valid = product && Number.isFinite(amount) && amount > 0;

  const create = async () => {
    if (!product || !valid) return;
    setBusy(true);
    try {
      const created = await svc.createManualOrder({ kind, sku: product.sku, sheetId: product.sheetId, quantity: amount, urgent, notes: notes.trim() || null });
      toast({ title: `OP ${opNumber(created.number)} gerada`, description: created.childCount ? `Mais ${created.childCount} OP(s) das partes para o corte.` : undefined });
      setProduct(null); setSearch(''); setQuantity(''); setUrgent(false); setNotes('');
      onCreated();
    } catch (e) {
      toast({ variant: 'destructive', title: 'Não foi possível gerar a OP', description: e instanceof Error ? e.message : undefined });
    } finally { setBusy(false); }
  };

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">OP avulsa</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">Gera uma OP de qualquer produto com ficha técnica e roteiro, sem passar pela fila de reposição. No corte, gera também as OPs das partes que têm ficha própria.</p>
        {!product ? (
          <div className="space-y-2">
            <Label htmlFor="manual-search">Produto</Label>
            <Input id="manual-search" placeholder={products ? 'Busque pelo SKU ou pelo nome' : 'Carregando produtos…'} disabled={!products}
              value={search} onChange={e => setSearch(e.target.value)} autoComplete="off" />
            {matches.length > 0 && (
              <ul className="max-h-72 divide-y overflow-auto rounded-md border">
                {matches.map(p => (
                  <li key={p.sheetId}>
                    <button type="button" className="flex w-full items-baseline gap-3 px-3 py-2 text-left hover:bg-muted" onClick={() => setProduct(p)}>
                      <span className="font-mono text-xs">{p.sku}</span><span className="truncate text-sm">{p.name}</span>
                      <span className="ml-auto shrink-0 text-xs text-muted-foreground">ficha {p.sheetCode}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {term && products && !matches.length && <p className="text-sm text-muted-foreground">Nenhum produto com ficha técnica e roteiro encontrado.</p>}
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3 rounded-md border p-3">
            <span className="font-mono text-xs">{product.sku}</span><span className="text-sm">{product.name}</span>
            <span className="text-xs text-muted-foreground">ficha {product.sheetCode} · {product.stepCount} OS</span>
            <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setProduct(null)}>Trocar</Button>
          </div>
        )}
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1"><Label>Tipo</Label>
            <div className="flex gap-1">{(['semanal', 'corte'] as OrderKind[]).map(k => (
              <Button key={k} type="button" size="sm" variant={kind === k ? 'default' : 'outline'} onClick={() => setKind(k)}>{KIND_LABEL[k]}</Button>))}</div></div>
          <div className="space-y-1"><Label htmlFor="manual-qty">Quantidade</Label>
            <Input id="manual-qty" className="w-32" type="number" min={1} value={quantity} onChange={e => setQuantity(e.target.value)} /></div>
          <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" checked={urgent} onChange={e => setUrgent(e.target.checked)} />Urgente</label>
        </div>
        {product && kind === 'corte' && product.partCount > 0 && (
          <p className="text-sm text-muted-foreground">Gera também {product.partCount} OP(s) das partes para o corte.</p>
        )}
        <div className="space-y-1"><Label htmlFor="manual-notes">Observação</Label>
          <Textarea id="manual-notes" rows={2} maxLength={2000} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Opcional: motivo, prazo" /></div>
        <div className="flex justify-end">
          <Button onClick={create} disabled={!valid || busy}>{busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Plus className="mr-1 h-4 w-4" />}Gerar OP</Button>
        </div>
      </CardContent>
    </Card>
  );
}
