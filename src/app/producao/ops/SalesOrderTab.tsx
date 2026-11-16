'use client';

import * as React from 'react';
import { Loader2, Plus, Search } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import * as svc from '@/services/production-orders-service';
import type { SalesOrderPreview } from '@/server/persistence/pcp-orders-contract';

const fmt = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
const opNumber = (n: number) => String(n).padStart(7, '0');
const STATUS_LABEL: Record<string, string> = { a_produzir: 'A produzir', produzindo: 'Produzindo', concluido: 'Concluído', suspenso: 'Suspenso' };
/** Chave de seleção: o produto, ou o produto e a parte. */
const key = (sku: string, part?: string) => (part ? `${sku}>${part}` : sku);

/** OP a partir de pedido de venda do Bling: produto na dobra, partes no corte. */
export default function SalesOrderTab({ onCreated }: { onCreated: () => void }) {
  const { toast } = useToast();
  const [number, setNumber] = React.useState('');
  const [preview, setPreview] = React.useState<SalesOrderPreview | null>(null);
  const [selected, setSelected] = React.useState<Record<string, number | null>>({});
  const [urgent, setUrgent] = React.useState(false);
  const [busy, setBusy] = React.useState<'search' | 'create' | null>(null);

  const search = async (event?: React.FormEvent) => {
    event?.preventDefault();
    if (!number.trim()) return;
    setBusy('search');
    try {
      const result = await svc.previewSalesOrder(number.trim());
      setPreview(result);
      // Já vem marcado tudo o que tem ficha, com as partes.
      const initial: Record<string, number | null> = {};
      for (const line of result.lines.filter(l => l.sheet)) {
        initial[key(line.sku)] = line.quantity;
        for (const part of line.parts) initial[key(line.sku, part.sku)] = part.quantity;
      }
      setSelected(initial);
      setUrgent(false);
    } catch (e) {
      setPreview(null);
      toast({ variant: 'destructive', title: 'Não foi possível buscar o pedido', description: e instanceof Error ? e.message : undefined });
    } finally { setBusy(null); }
  };

  const isOn = (k: string) => selected[k] != null && Number(selected[k]) > 0;
  const items = (preview?.lines ?? []).filter(l => l.sheet && isOn(key(l.sku))).map(line => ({
    sku: line.sku, sheetId: line.sheet!.id, quantity: Number(selected[key(line.sku)]), description: line.description,
    parts: line.parts.filter(p => isOn(key(line.sku, p.sku))).map(p => ({
      sku: p.sku, sheetId: p.sheet.id, quantity: Number(selected[key(line.sku, p.sku)]), description: p.description })),
  }));
  const partCount = items.reduce((n, i) => n + i.parts.length, 0);
  const duplicate = Boolean(preview?.existing.length);

  const create = async () => {
    if (!preview || !items.length) return;
    setBusy('create');
    try {
      const created = await svc.createFromSalesOrder({ blingOrderId: preview.order.blingId, urgent, confirmDuplicate: duplicate, items });
      toast({ title: `${created.orderCount} OP(s) do pedido ${created.salesOrderNumber} geradas`,
        description: created.childCount ? `Mais ${created.childCount} OP(s) das partes para o corte.` : undefined });
      setPreview(null); setNumber('');
      onCreated();
    } catch (e) {
      toast({ variant: 'destructive', title: 'Não foi possível gerar as OPs', description: e instanceof Error ? e.message : undefined });
    } finally { setBusy(null); }
  };

  const quantityInput = (k: string, label: string, fallback: number) => (
    <Input className="h-8" type="number" min={1} aria-label={label} disabled={selected[k] == null}
      value={selected[k] ?? fallback} onChange={e => setSelected(cur => ({ ...cur, [k]: Number(e.target.value) }))} />
  );
  const check = (k: string, label: string, fallback: number, disabled = false) => (
    <input type="checkbox" aria-label={label} disabled={disabled} checked={selected[k] != null}
      onChange={e => setSelected(cur => ({ ...cur, [k]: e.target.checked ? fallback : null }))} />
  );

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">OP a partir de pedido do Bling</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <form className="flex flex-wrap items-end gap-3" onSubmit={search}>
          <div className="space-y-1"><Label htmlFor="sales-number">Número do pedido</Label>
            <Input id="sales-number" className="w-56" value={number} onChange={e => setNumber(e.target.value)} placeholder="Número no Bling ou na loja" autoComplete="off" /></div>
          <Button type="submit" disabled={!number.trim() || busy !== null}>
            {busy === 'search' ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Search className="mr-1 h-4 w-4" />}{busy === 'search' ? 'Lendo o Bling…' : 'Buscar no Bling'}</Button>
        </form>
        <p className="text-xs text-muted-foreground">
          O produto do pedido vira uma OP de produção semanal (dobra) e cada parte da ficha técnica que tem ficha própria vira uma OP de corte ligada a ela. Kit do Bling sem ficha é aberto nos seus componentes. Nada é gravado no Bling.
        </p>

        {preview && <>
          <div className="flex flex-wrap gap-x-6 gap-y-1 rounded-md border p-3 text-sm">
            <span>Pedido <strong>{preview.order.number}</strong></span>
            {preview.order.storeNumber && <span>Loja: {preview.order.storeNumber}</span>}
            {preview.order.date && <span>Data: {preview.order.date.split('-').reverse().join('/')}</span>}
            {preview.order.customerName && <span>Cliente: {preview.order.customerName}</span>}
          </div>
          {preview.warnings.map(w => <p key={w} className="text-sm text-amber-600">{w}</p>)}
          {duplicate && (
            <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200">
              Este pedido já gerou a(s) OP(s) {preview.existing.map(o => `${opNumber(o.number)} (${o.sku}, ${STATUS_LABEL[o.status] ?? o.status})`).join(', ')}.
              Gerar de novo cria OPs novas.
            </p>
          )}
          <Table>
            <TableHeader><TableRow><TableHead className="w-8" /><TableHead>SKU</TableHead><TableHead>Produto</TableHead><TableHead>Vai para</TableHead><TableHead>Ficha</TableHead><TableHead className="w-28">Quantidade</TableHead></TableRow></TableHeader>
            <TableBody>
              {preview.lines.map(line => (
                <React.Fragment key={line.sku}>
                  <TableRow className={line.sheet ? '' : 'opacity-60'}>
                    <TableCell>{check(key(line.sku), `Incluir ${line.sku}`, line.quantity, !line.sheet)}</TableCell>
                    <TableCell className="font-mono text-xs">{line.sku}</TableCell>
                    <TableCell className="max-w-72"><span className="block truncate" title={line.description ?? ''}>{line.description}</span>
                      {line.source === 'kit' && <span className="text-xs text-muted-foreground">do kit {line.kitSkus.join(', ')}</span>}
                      {line.materials.length > 0 && <span className="block text-xs text-muted-foreground">Também usa: {line.materials.join(', ')}</span>}</TableCell>
                    <TableCell>Dobra</TableCell>
                    <TableCell className="font-mono text-xs">{line.sheet ? line.sheet.code : <Badge variant="outline">Sem ficha</Badge>}</TableCell>
                    <TableCell>{line.sheet ? quantityInput(key(line.sku), `Quantidade de ${line.sku}`, line.quantity) : fmt(line.quantity)}</TableCell>
                  </TableRow>
                  {line.parts.map(part => {
                    const k = key(line.sku, part.sku);
                    return (
                      <TableRow key={k} className={isOn(key(line.sku)) ? '' : 'opacity-50'}>
                        <TableCell className="pl-6">{check(k, `Incluir parte ${part.sku}`, part.quantity, !isOn(key(line.sku)))}</TableCell>
                        <TableCell className="pl-6 font-mono text-xs">↳ {part.sku}</TableCell>
                        <TableCell className="max-w-72 truncate" title={part.description ?? ''}>{part.description}</TableCell>
                        <TableCell>Corte</TableCell>
                        <TableCell className="font-mono text-xs">{part.sheet.code}</TableCell>
                        <TableCell>{quantityInput(k, `Quantidade da parte ${part.sku}`, part.quantity)}</TableCell>
                      </TableRow>
                    );
                  })}
                </React.Fragment>
              ))}
            </TableBody>
          </Table>
          {!preview.lines.length && <p className="text-sm text-muted-foreground">O pedido não tem itens com código.</p>}
          <div className="flex flex-wrap items-center justify-end gap-3">
            <label className="mr-auto flex items-center gap-2 text-sm"><input type="checkbox" checked={urgent} onChange={e => setUrgent(e.target.checked)} />Pedido urgente (fura a fila no quadro)</label>
            <span className="text-sm text-muted-foreground">{items.length} OP(s) de dobra, {partCount} de corte</span>
            <Button onClick={create} disabled={!items.length || busy !== null} variant={duplicate ? 'destructive' : 'default'}>
              {busy === 'create' ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Plus className="mr-1 h-4 w-4" />}{duplicate ? 'Gerar mesmo assim' : 'Gerar OPs'}</Button>
          </div>
        </>}
      </CardContent>
    </Card>
  );
}
