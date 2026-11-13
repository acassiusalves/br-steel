'use client';

import * as React from 'react';
import * as XLSX from 'xlsx';
import { format, subDays } from 'date-fns';
import { Download, Loader2, Sparkles } from 'lucide-react';
import DashboardLayout from '@/components/dashboard-layout';
import { useToast } from '@/hooks/use-toast';
import { subscribeOperation } from '@/lib/operation-client';
import { DEFAULT_FACTORS, type OrderKind } from '@/lib/pcp/op-generator';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import * as svc from '@/services/production-orders-service';
import type { BatchSummary, GenerationPreview, ProductionOrderRow } from '@/server/persistence/pcp-orders-contract';

const KIND_LABEL: Record<OrderKind, string> = { semanal: 'Produção semanal (dobra)', corte: 'Corte' };
const STATUS_LABEL: Record<string, string> = { a_produzir: 'A produzir', produzindo: 'Produzindo', concluido: 'Concluído', suspenso: 'Suspenso', encerrado: 'Encerrado' };
const fmt = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
const opNumber = (n: number) => String(n).padStart(7, '0');

/** Planilha no modelo de importação de OP do iApp, para rodar em paralelo até o iApp sair. */
function downloadIapp(header: readonly string[], rows: (string | number)[][], kind: OrderKind) {
  const sheet = XLSX.utils.aoa_to_sheet([[...header], ...rows]);
  // A identificação da ficha precisa ir como texto, senão o Excel tira os zeros à esquerda.
  rows.forEach((_, i) => { const cell = sheet[XLSX.utils.encode_cell({ r: i + 1, c: 0 })]; if (cell) { cell.t = 's'; cell.z = '@'; } });
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'Planilha1');
  XLSX.writeFile(book, `ops-iapp-${kind}-${format(new Date(), 'yyyy-MM-dd-HHmm')}.xlsx`);
}

function Generator({ onCreated }: { onCreated: () => void }) {
  const { toast } = useToast();
  const [kind, setKind] = React.useState<OrderKind>('semanal');
  const [factor, setFactor] = React.useState(DEFAULT_FACTORS.semanal);
  const [from, setFrom] = React.useState(format(subDays(new Date(), 84), 'yyyy-MM-dd'));
  const [to, setTo] = React.useState(format(new Date(), 'yyyy-MM-dd'));
  const [preview, setPreview] = React.useState<GenerationPreview | null>(null);
  const [selected, setSelected] = React.useState<Record<string, number | null>>({});
  const [busy, setBusy] = React.useState<'preview' | 'create' | null>(null);

  const changeKind = (next: OrderKind) => { setKind(next); setFactor(DEFAULT_FACTORS[next]); setPreview(null); };

  const calculate = async () => {
    setBusy('preview');
    try {
      const result = await svc.previewOrders({ kind, factor, from, to });
      setPreview(result);
      // Já vem marcado tudo o que tem ficha; quem não tem ficha não pode virar OP.
      setSelected(Object.fromEntries(result.suggestions.filter(s => s.sheet).map(s => [s.sku, s.quantity])));
    } catch (e) {
      toast({ variant: 'destructive', title: 'Não foi possível calcular a fila', description: e instanceof Error ? e.message : undefined });
    } finally { setBusy(null); }
  };

  const chosen = (preview?.suggestions ?? []).filter(s => s.sheet && selected[s.sku] != null && Number(selected[s.sku]) > 0);
  const create = async () => {
    if (!preview || !chosen.length) return;
    setBusy('create');
    try {
      const created = await svc.createOrderBatch({ kind, factor, from, to,
        items: chosen.map(s => ({ sku: s.sku, sheetId: s.sheet!.id, quantity: Number(selected[s.sku]), description: s.description })) });
      toast({ title: `${created.orderCount} OP(s) geradas`, description: created.childCount ? `Mais ${created.childCount} OP(s) das partes para o corte.` : undefined });
      setPreview(null);
      onCreated();
    } catch (e) {
      toast({ variant: 'destructive', title: 'Não foi possível gerar as OPs', description: e instanceof Error ? e.message : undefined });
    } finally { setBusy(null); }
  };

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Gerar OPs pela fila de produção</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1"><Label>Tipo</Label>
            <div className="flex gap-1">{(['semanal', 'corte'] as OrderKind[]).map(k => (
              <Button key={k} type="button" size="sm" variant={kind === k ? 'default' : 'outline'} onClick={() => changeKind(k)}>{KIND_LABEL[k]}</Button>))}</div></div>
          <div className="space-y-1"><Label htmlFor="ops-from">Vendas de</Label><Input id="ops-from" type="date" value={from} onChange={e => setFrom(e.target.value)} /></div>
          <div className="space-y-1"><Label htmlFor="ops-to">até</Label><Input id="ops-to" type="date" value={to} onChange={e => setTo(e.target.value)} /></div>
          <div className="space-y-1"><Label htmlFor="ops-factor">Fator sobre a média semanal</Label>
            <Input id="ops-factor" className="w-28" type="number" step="0.1" min={0.1} value={factor} onChange={e => setFactor(Number(e.target.value))} /></div>
          <Button onClick={calculate} disabled={busy !== null}>{busy === 'preview' ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1 h-4 w-4" />}Calcular sugestão</Button>
        </div>
        <p className="text-xs text-muted-foreground">Entram os itens abaixo do estoque mínimo, na ordem da fila: zerados primeiro, depois o maior déficit, depois os mais vendidos. A quantidade sugerida é a média semanal × fator, sem ficar abaixo do que falta para o mínimo.</p>

        {preview && <>
          {preview.warnings.map(w => <p key={w} className="text-sm text-amber-600">{w}</p>)}
          <Table>
            <TableHeader><TableRow><TableHead className="w-8" /><TableHead>#</TableHead><TableHead>SKU</TableHead><TableHead>Produto</TableHead><TableHead className="text-right">Estoque</TableHead><TableHead className="text-right">Mín.</TableHead><TableHead className="text-right">Vendidos</TableHead><TableHead className="text-right">Média/sem.</TableHead><TableHead>Ficha</TableHead><TableHead className="w-28">Quantidade</TableHead></TableRow></TableHeader>
            <TableBody>
              {preview.suggestions.map((s, i) => (
                <TableRow key={s.sku} className={s.sheet ? '' : 'opacity-60'}>
                  <TableCell><input type="checkbox" aria-label={`Incluir ${s.sku}`} disabled={!s.sheet} checked={selected[s.sku] != null}
                    onChange={e => setSelected(cur => ({ ...cur, [s.sku]: e.target.checked ? s.quantity : null }))} /></TableCell>
                  <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                  <TableCell className="font-mono text-xs">{s.sku}</TableCell><TableCell className="max-w-64 truncate" title={s.description}>{s.description}</TableCell>
                  <TableCell className={`text-right ${s.stock === 0 ? 'font-semibold text-destructive' : ''}`}>{fmt(s.stock)}</TableCell>
                  <TableCell className="text-right">{fmt(s.min)}</TableCell><TableCell className="text-right">{fmt(s.sold)}</TableCell><TableCell className="text-right">{fmt(s.weeklyAverage)}</TableCell>
                  <TableCell className="font-mono text-xs">{s.sheet ? s.sheet.code : <Badge variant="outline">Sem ficha</Badge>}</TableCell>
                  <TableCell><Input className="h-8" type="number" min={1} aria-label={`Quantidade de ${s.sku}`} disabled={selected[s.sku] == null}
                    value={selected[s.sku] ?? s.quantity} onChange={e => setSelected(cur => ({ ...cur, [s.sku]: Number(e.target.value) }))} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {!preview.suggestions.length && <p className="text-sm text-muted-foreground">Nenhum item abaixo do mínimo no período.</p>}
          <div className="flex items-center justify-end gap-3">
            <span className="text-sm text-muted-foreground">{chosen.length} item(ns) selecionado(s)</span>
            <Button onClick={create} disabled={!chosen.length || busy !== null}>{busy === 'create' && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Gerar {chosen.length} OP(s)</Button>
          </div>
        </>}
      </CardContent>
    </Card>
  );
}

export default function OrdersClient() {
  const { toast } = useToast();
  const [batches, setBatches] = React.useState<BatchSummary[] | null>(null);
  const [orders, setOrders] = React.useState<ProductionOrderRow[] | null>(null);
  const [tab, setTab] = React.useState('gerar');
  const [exporting, setExporting] = React.useState<string | null>(null);

  React.useEffect(() => subscribeOperation(async () => Promise.all([svc.getBatches(), svc.getOrders()]),
    ([b, o]) => { setBatches(b); setOrders(o); },
    e => toast({ variant: 'destructive', title: 'Erro ao carregar OPs', description: e.message })), [toast]);

  const exportBatch = async (batch: BatchSummary) => {
    setExporting(batch.id);
    try {
      const data = await svc.exportIapp(batch.id);
      downloadIapp(data.header, data.rows, data.kind);
    } catch (e) {
      toast({ variant: 'destructive', title: 'Não foi possível gerar a planilha', description: e instanceof Error ? e.message : undefined });
    } finally { setExporting(null); }
  };

  return (
    <DashboardLayout>
      <div className="space-y-4 p-4 md:p-6">
        <div>
          <h1 className="text-2xl font-semibold">Ordens de produção</h1>
          <p className="text-sm text-muted-foreground">Gera as OPs pela fila de produção, com o roteiro de cada ficha técnica, e a planilha para importar no iApp enquanto os dois sistemas rodam juntos.</p>
        </div>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList><TabsTrigger value="gerar">Gerar</TabsTrigger><TabsTrigger value="lotes">Lotes gerados</TabsTrigger><TabsTrigger value="ops">OPs</TabsTrigger></TabsList>
          <TabsContent value="gerar"><Generator onCreated={() => setTab('lotes')} /></TabsContent>
          <TabsContent value="lotes">
            <Table>
              <TableHeader><TableRow><TableHead>Gerado em</TableHead><TableHead>Tipo</TableHead><TableHead className="text-right">OPs</TableHead><TableHead className="text-right">OPs das partes</TableHead><TableHead>Planilha do iApp</TableHead><TableHead /></TableRow></TableHeader>
              <TableBody>
                {(batches ?? []).map(b => (
                  <TableRow key={b.id}>
                    <TableCell>{new Date(b.createdAt).toLocaleString('pt-BR')}</TableCell><TableCell>{KIND_LABEL[b.kind]}</TableCell>
                    <TableCell className="text-right">{b.orderCount}</TableCell><TableCell className="text-right">{b.childCount || '—'}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{b.exportedAt ? `Baixada em ${new Date(b.exportedAt).toLocaleString('pt-BR')}` : 'Ainda não baixada'}</TableCell>
                    <TableCell><Button size="sm" variant="outline" disabled={exporting === b.id} onClick={() => exportBatch(b)}>
                      {exporting === b.id ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Download className="mr-1 h-4 w-4" />}Planilha iApp</Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {batches?.length === 0 && <p className="p-4 text-sm text-muted-foreground">Nenhum lote gerado ainda.</p>}
          </TabsContent>
          <TabsContent value="ops">
            <Table>
              <TableHeader><TableRow><TableHead>OP</TableHead><TableHead>Tipo</TableHead><TableHead>SKU</TableHead><TableHead>Produto</TableHead><TableHead>Ficha</TableHead><TableHead className="text-right">Qtde</TableHead><TableHead className="text-right">OS</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
              <TableBody>
                {(orders ?? []).map(o => (
                  <TableRow key={o.id}>
                    <TableCell className="font-mono text-xs">{opNumber(o.number)}{o.parentOrderId && <span className="ml-1 text-muted-foreground">(parte)</span>}</TableCell>
                    <TableCell>{o.kind === 'corte' ? 'Corte' : 'Semanal'}</TableCell><TableCell className="font-mono text-xs">{o.sku}</TableCell>
                    <TableCell className="max-w-64 truncate" title={o.description ?? ''}>{o.description}</TableCell><TableCell className="font-mono text-xs">{o.sheetCode}</TableCell>
                    <TableCell className="text-right">{fmt(o.quantity)}</TableCell><TableCell className="text-right">{o.stepCount}</TableCell>
                    <TableCell><Badge variant="outline">{STATUS_LABEL[o.status]}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {orders?.length === 0 && <p className="p-4 text-sm text-muted-foreground">Nenhuma OP gerada ainda.</p>}
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
