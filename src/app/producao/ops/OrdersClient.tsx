'use client';

import * as React from 'react';
import * as XLSX from 'xlsx';
import { format } from 'date-fns';
import { Download, Loader2, Sparkles } from 'lucide-react';
import DashboardLayout from '@/components/dashboard-layout';
import { useToast } from '@/hooks/use-toast';
import { subscribeOperation } from '@/lib/operation-client';
import { saoPauloDay } from '@/lib/iso-week';
import { DEFAULT_FACTORS, type OrderKind } from '@/lib/pcp/op-generator';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import * as svc from '@/services/production-orders-service';
import ManualOrderTab from './ManualOrderTab';
import SalesOrderTab from './SalesOrderTab';
import {
  buildSuggestionWorkbook, getQueueDefaults, queueBlockers, queueTierLabel, STOCK_SOURCE_LABEL,
  type QueueMode, type QueueReviewRows,
} from './queue-review';
import type { BatchSummary, GenerationPreview, ProductionOrderRow } from '@/server/persistence/pcp-orders-contract';

const KIND_LABEL: Record<OrderKind, string> = { semanal: 'Produção semanal (dobra)', corte: 'Corte' };
const STATUS_LABEL: Record<string, string> = { a_produzir: 'A produzir', produzindo: 'Produzindo', concluido: 'Concluído', suspenso: 'Suspenso', encerrado: 'Encerrado' };
const fmt = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
const opNumber = (n: number) => String(n).padStart(7, '0');
const originLabel = (origin: string, salesOrderNumber: string | null) =>
  origin === 'pedido' ? `Pedido ${salesOrderNumber ?? ''}`.trim() : origin === 'avulsa' ? 'Avulsa' : origin === 'iapp' ? 'iApp' : 'Fila';

/** Planilha no modelo de importação de OP do iApp, para rodar em paralelo até o iApp sair. */
function downloadIapp(header: readonly string[], rows: (string | number)[][], kind: OrderKind) {
  const sheet = XLSX.utils.aoa_to_sheet([[...header], ...rows]);
  // A identificação da ficha precisa ir como texto, senão o Excel tira os zeros à esquerda.
  rows.forEach((_, i) => { const cell = sheet[XLSX.utils.encode_cell({ r: i + 1, c: 0 })]; if (cell) { cell.t = 's'; cell.z = '@'; } });
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'Planilha1');
  XLSX.writeFile(book, `ops-iapp-${kind}-${format(new Date(), 'yyyy-MM-dd-HHmm')}.xlsx`);
}

const PROGRESS_LABEL: Record<svc.PreviewProgress['stage'], string> = {
  sales: 'Conferindo notas fiscais',
  catalog: 'Lendo categorias e produtos',
  stock: 'Consultando estoque',
  sheets: 'Conferindo fichas e OPs abertas',
};

type PreviewReview = { preview: GenerationPreview; rows: QueueReviewRows; idempotencyKey?: string };
const MAX_BATCH_ITEMS = 300;
const validQuantity = (value: string) => Number(value) > 0 && Number(value) <= 1_000_000;
const formatAverage = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format;

function Generator({ onCreated }: { onCreated: () => void }) {
  const { toast } = useToast();
  const [filters, setFilters] = React.useState(() => ({
    ...getQueueDefaults('bling', 'semanal'), factor: '1',
  }));
  const [review, setReview] = React.useState<PreviewReview | null>(null);
  const [busy, setBusy] = React.useState<'preview' | 'create' | null>(null);
  const [progress, setProgress] = React.useState<svc.PreviewProgress | null>(null);
  const inFlight = React.useRef(false);
  const { kind, from, to, factor } = filters;
  const mode = filters.policy ?? 'legacy';
  const preview = review?.preview;
  const selectedRows = preview?.suggestions.filter(row => review?.rows[row.sku]?.selected) ?? [];
  const invalidQuantity = selectedRows.some(row => !validQuantity(review?.rows[row.sku]?.quantity ?? ''));
  const canSend = mode === 'legacy' || Boolean(preview?.previewToken);
  const tooManySelected = selectedRows.length > MAX_BATCH_ITEMS;
  const canGenerate = canSend && selectedRows.length > 0 && !invalidQuantity && !tooManySelected;
  const today = saoPauloDay(new Date());
  const margin = Number(factor);
  const filterError = !from || !to ? 'Informe as duas datas do período.'
    : from > to ? 'A data final deve ser igual ou posterior à data inicial.'
    : mode === 'bling' && to > today ? 'Informe uma data final até hoje.'
    : !Number.isFinite(margin) || margin > 10 || margin <= 0 || (mode === 'legacy' && margin < 0.1)
      ? (mode === 'bling' ? 'Informe uma margem maior que zero e até 10.' : 'Informe uma margem entre 0,1 e 10.')
    : null;

  const changeFilters = (changes: Partial<typeof filters>) => {
    setFilters(current => ({ ...current, ...changes }));
    setReview(null);
  };

  const changeKind = (next: OrderKind) => {
    if (next !== kind) changeFilters({ kind: next, factor: mode === 'bling' ? factor : String(DEFAULT_FACTORS[next]) });
  };

  const changeMode = (next: QueueMode) => {
    const defaults = getQueueDefaults(next, kind);
    changeFilters({ ...defaults, factor: String(defaults.factor), policy: defaults.policy });
  };

  const calculate = async () => {
    if (inFlight.current || filterError) return;
    const input = { ...filters, factor: Number(factor) };
    inFlight.current = true;
    setReview(null);
    setProgress(null);
    setBusy('preview');
    try {
      const result = await svc.previewOrders(input, setProgress);
      const rules = input.policy ?? 'legacy';
      setReview({
        preview: { ...result, policy: input.policy },
        rows: Object.fromEntries(result.suggestions.map(row => [row.sku, {
          selected: !queueBlockers(row, rules).length, quantity: String(row.quantity),
        }])),
        idempotencyKey: input.policy === 'bling' ? crypto.randomUUID() : undefined,
      });
    } catch (e) {
      toast({ variant: 'destructive', title: 'Não foi possível calcular a fila', description: e instanceof Error ? e.message : undefined });
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  };

  const changeRow = (sku: string, change: Partial<QueueReviewRows[string]>) => {
    setReview(current => current && ({
      ...current, rows: { ...current.rows, [sku]: { ...current.rows[sku], ...change } },
    }));
  };

  const selectRows = (selected: boolean) => {
    setReview(current => current && ({
      ...current, rows: Object.fromEntries(current.preview.suggestions.map(row => [row.sku, {
        ...current.rows[row.sku], selected: selected && !queueBlockers(row, mode).length,
      }])),
    }));
  };

  const downloadSuggestion = () => {
    if (!review) return;
    const { kind, from, to } = review.preview;
    XLSX.writeFile(buildSuggestionWorkbook(review.preview, review.rows), `sugestao-ops-${kind}-${from}-a-${to}.xlsx`);
  };

  const create = async () => {
    if (inFlight.current || !review || !canGenerate) return;
    const { kind, factor, from, to, policy, previewToken } = review.preview;
    const items = selectedRows.flatMap(row => row.sheet && !queueBlockers(row, mode).length ? [{
      sku: row.sku,
      sheetId: row.sheet.id,
      quantity: Number(review.rows[row.sku].quantity),
      description: row.description,
    }] : []);
    if (!items.length) return;
    inFlight.current = true;
    setBusy('create');
    try {
      const created = await svc.createOrderBatch({
        kind, factor, from, to, items,
        ...(policy === 'bling' ? { policy, previewToken, idempotencyKey: review.idempotencyKey } : {}),
      });
      toast({
        title: created.orderCount === 1 ? '1 OP gerada' : `${created.orderCount} OPs geradas`,
        description: created.childCount
          ? created.childCount === 1 ? 'O lote também inclui 1 OP de parte.' : `O lote também inclui ${created.childCount} OPs de partes.`
          : undefined,
      });
      setReview(null);
      onCreated();
    } catch (e) {
      toast({ variant: 'destructive', title: 'Não foi possível gerar as OPs', description: e instanceof Error ? e.message : undefined });
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  };

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Gerar OPs pela fila de produção</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <fieldset className="flex flex-wrap items-end gap-3" disabled={busy !== null}>
          <div className="space-y-1">
            <Label htmlFor="ops-policy">Cálculo da fila</Label>
            <Select value={mode} onValueChange={changeMode} disabled={busy !== null}>
              <SelectTrigger id="ops-policy"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="bling">Por categoria do Bling</SelectItem>
                <SelectItem value="legacy">Regra anterior</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label id="ops-kind">Tipo</Label>
            <div className="flex gap-1" role="group" aria-labelledby="ops-kind">
              {(['semanal', 'corte'] as const).map(value => (
                <Button key={value} type="button" variant={kind === value ? 'default' : 'outline'}
                  aria-pressed={kind === value} onClick={() => changeKind(value)}>
                  {KIND_LABEL[value]}
                </Button>
              ))}
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="ops-from">Vendas de</Label>
            <Input id="ops-from" type="date" value={from} max={mode === 'bling' ? today : undefined} onChange={e => changeFilters({ from: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ops-to">Vendas até</Label>
            <Input id="ops-to" type="date" value={to} max={mode === 'bling' ? today : undefined} onChange={e => changeFilters({ to: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ops-factor">Margem</Label>
            <Input id="ops-factor" className="w-28" type="number" step="any" min={mode === 'bling' ? 0 : 0.1} max={10} value={factor} onChange={e => changeFilters({ factor: e.target.value })} />
          </div>
          <Button type="button" onClick={calculate} disabled={busy !== null || Boolean(filterError)}>
            {busy === 'preview' ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1 h-4 w-4" />}
            {busy === 'preview' ? 'Calculando…' : 'Calcular sugestão'}
          </Button>
        </fieldset>
        {filterError && <p className="text-sm text-destructive">{filterError}</p>}
        {busy === 'preview' && (
          <p role="status" className="text-sm text-muted-foreground">
            {progress ? PROGRESS_LABEL[progress.stage] : 'Preparando consulta'}
            {progress?.completed !== undefined && progress.total !== undefined && ` (${progress.completed} de ${progress.total})`}
          </p>
        )}

        <details className="text-sm text-muted-foreground">
          <summary className="cursor-pointer select-none">Como a fila é calculada</summary>
          <div className="mt-2 space-y-1">
            {mode === 'bling' ? (
              <>
                <p>Considera as vendas por NF-e de produtos ativos da categoria Produtos Inox Marketplace e de suas subcategorias.</p>
                <p>Prioriza estoque zerado ou negativo, depois saldo abaixo do mínimo. Em cada faixa, os mais vendidos vêm primeiro. A quantidade é a média semanal multiplicada pela margem, arredondada para cima, com sugestão mínima de 5.</p>
                <p>A coluna Em OP mostra o que já está em produção para ajudar na revisão.</p>
              </>
            ) : (
              <>
                <p>Usa os SKUs da linha oficial e soma o estoque do Bling à quantidade em OP aberta. Quando não há nenhum zerado, também entram os itens entre o mínimo e o máximo.</p>
                <p>Usa a média semanal de vendas por NF-e e a margem do tipo escolhido.</p>
              </>
            )}
            {preview?.notes.map((note, i) => <p key={i}>{note}</p>)}
            {preview?.catalogSyncedAt && Number.isFinite(Date.parse(preview.catalogSyncedAt)) && (
              <p>Cadastro do Bling atualizado em {new Date(preview.catalogSyncedAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}.</p>
            )}
          </div>
        </details>

        {preview && review && (
          <>
            {(preview.weeks !== undefined || preview.invoiceCount !== undefined || Boolean(preview.categories?.length)) && (
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                {preview.invoiceCount !== undefined && <span>{fmt(preview.invoiceCount)} NF-e no período</span>}
                {preview.weeks !== undefined && <span>{fmt(preview.weeks)} {preview.weeks === 1 ? 'semana' : 'semanas'}</span>}
                {Boolean(preview.categories?.length) && <span>{preview.categories?.join(', ')}</span>}
              </div>
            )}
            {preview.warnings.map((warning, i) => <p key={i} className="text-sm text-amber-700 dark:text-amber-400">{warning}</p>)}
            {Boolean(preview.ignored?.length) && (
              <details className="text-sm">
                <summary className="cursor-pointer">Itens ignorados por quantidade ({preview.ignored?.length})</summary>
                <Table>
                  <TableHeader><TableRow><TableHead>NF-e</TableHead><TableHead>SKU</TableHead><TableHead className="text-right">Quantidade</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {preview.ignored?.map((item, i) => (
                      <TableRow key={i}><TableCell>{item.invoice}</TableCell><TableCell>{item.sku}</TableCell><TableCell className="text-right">{fmt(item.quantity)}</TableCell></TableRow>
                    ))}
                  </TableBody>
                </Table>
              </details>
            )}
            {preview.suggestions.length ? (
              <>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" variant="outline" disabled={busy !== null || !preview.suggestions.some(row => !queueBlockers(row, mode).length && !review.rows[row.sku].selected)} onClick={() => selectRows(true)}>Marcar disponíveis</Button>
                  <Button type="button" size="sm" variant="outline" disabled={busy !== null || !selectedRows.length} onClick={() => selectRows(false)}>Desmarcar todos</Button>
                  <Button type="button" size="sm" variant="outline" onClick={downloadSuggestion}><Download className="mr-1 h-4 w-4" />Baixar sugestão em XLSX</Button>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8"><span className="sr-only">Incluir no lote</span></TableHead>
                      <TableHead>SKU</TableHead><TableHead>Produto</TableHead><TableHead>Faixa</TableHead>
                      <TableHead className="text-right">Estoque</TableHead>
                      <TableHead className="text-right">{mode === 'bling' ? 'Mínimo' : 'Mín./Máx.'}</TableHead>
                      <TableHead className="text-right">Em OP</TableHead><TableHead className="text-right">Vendidos</TableHead>
                      <TableHead className="text-right">Média/sem.</TableHead><TableHead>Ficha</TableHead>
                      {mode === 'bling' && <TableHead>Estrutura no Bling</TableHead>}
                      <TableHead className="w-32">Quantidade</TableHead><TableHead>Pendências</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.suggestions.map((row, i) => {
                      const { selected, quantity } = review.rows[row.sku];
                      const blockers = queueBlockers(row, mode);
                      const blocked = blockers.length > 0;
                      return (
                        <TableRow key={row.sku}>
                          <TableCell>
                            <input type="checkbox" aria-label={`Incluir ${row.sku}`}
                              aria-describedby={blocked ? `ops-blockers-${i}` : undefined}
                              disabled={blocked || busy !== null} checked={selected}
                              onChange={e => changeRow(row.sku, { selected: e.target.checked })} />
                          </TableCell>
                          <TableCell className="font-mono text-xs">{row.sku}</TableCell>
                          <TableCell className="max-w-64 truncate" title={row.description}>{row.description}</TableCell>
                          <TableCell className="whitespace-nowrap text-xs">{queueTierLabel(row.tier, mode)}</TableCell>
                          <TableCell className="text-right">
                            <span className={row.stock <= 0 ? 'font-semibold text-destructive' : ''}>{fmt(row.stock)}</span>
                            {row.stockSource && <span className="block whitespace-nowrap text-xs text-muted-foreground">{STOCK_SOURCE_LABEL[row.stockSource]}</span>}
                          </TableCell>
                          <TableCell className="text-right">{mode === 'bling' ? fmt(row.min) : `${fmt(row.min)}/${fmt(row.max)}`}</TableCell>
                          <TableCell className="text-right">{row.openQuantity ? fmt(row.openQuantity) : '—'}</TableCell>
                          <TableCell className="text-right">{fmt(row.sold)}</TableCell>
                          <TableCell className="text-right">{mode === 'bling' ? formatAverage(row.weeklyAverage) : fmt(row.weeklyAverage)}</TableCell>
                          <TableCell className="font-mono text-xs">{row.sheet?.code ?? '—'}</TableCell>
                          {mode === 'bling' && <TableCell>{row.hasStructure === undefined ? '—' : row.hasStructure ? 'Sim' : 'Não'}</TableCell>}
                          <TableCell>
                            <Input className="h-8 min-w-24" type="number" step="any" max={1_000_000} aria-label={`Quantidade de ${row.sku}`}
                              aria-invalid={selected && !validQuantity(quantity)} disabled={blocked || busy !== null}
                              value={quantity} onChange={e => changeRow(row.sku, { quantity: e.target.value })} />
                          </TableCell>
                          <TableCell id={`ops-blockers-${i}`} className="text-xs text-muted-foreground">
                            {blockers.length ? blockers.join(' · ') : '—'}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
                {invalidQuantity && <p className="text-sm text-destructive">Informe quantidades maiores que zero e de até 1.000.000 para os itens selecionados.</p>}
                {tooManySelected && <p className="text-sm text-destructive">Selecione até {MAX_BATCH_ITEMS} itens para gerar um lote.</p>}
                {!canSend && <p className="text-sm text-muted-foreground">Esta prévia está disponível para consulta e download.</p>}
                <div className="flex flex-wrap items-center justify-end gap-3">
                  <span className="text-sm text-muted-foreground" role="status">
                    {selectedRows.length === 1 ? '1 item selecionado' : `${selectedRows.length} itens selecionados`}
                  </span>
                  <Button type="button" onClick={create} disabled={!canGenerate || busy !== null}>
                    {busy === 'create' && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                    {busy === 'create' ? 'Gerando lote…' : 'Gerar lote de OPs'}
                  </Button>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Nenhum SKU atende aos critérios da fila neste período.</p>
            )}
          </>
        )}
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
          <p className="text-sm text-muted-foreground">Gera as OPs pela fila de produção, avulsas ou a partir de um pedido de venda do Bling, com o roteiro de cada ficha técnica, e a planilha para importar no iApp enquanto os dois sistemas rodam juntos.</p>
        </div>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="flex-wrap"><TabsTrigger value="gerar">Gerar pela fila</TabsTrigger><TabsTrigger value="avulsa">OP avulsa</TabsTrigger><TabsTrigger value="pedido">Pedido do Bling</TabsTrigger><TabsTrigger value="lotes">Lotes gerados</TabsTrigger><TabsTrigger value="ops">OPs</TabsTrigger></TabsList>
          <TabsContent value="gerar"><Generator onCreated={() => setTab('lotes')} /></TabsContent>
          <TabsContent value="avulsa"><ManualOrderTab onCreated={() => setTab('ops')} /></TabsContent>
          <TabsContent value="pedido"><SalesOrderTab onCreated={() => setTab('ops')} /></TabsContent>
          <TabsContent value="lotes">
            <Table>
              <TableHeader><TableRow><TableHead>Gerado em</TableHead><TableHead>Origem</TableHead><TableHead>Tipo</TableHead><TableHead className="text-right">OPs</TableHead><TableHead className="text-right">OPs das partes</TableHead><TableHead>Planilha do iApp</TableHead><TableHead /></TableRow></TableHeader>
              <TableBody>
                {(batches ?? []).map(b => (
                  <TableRow key={b.id}>
                    <TableCell>{new Date(b.createdAt).toLocaleString('pt-BR')}</TableCell><TableCell>{originLabel(b.origin, b.salesOrderNumber)}</TableCell><TableCell>{KIND_LABEL[b.kind]}</TableCell>
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
              <TableHeader><TableRow><TableHead>OP</TableHead><TableHead>Origem</TableHead><TableHead>Tipo</TableHead><TableHead>SKU</TableHead><TableHead>Produto</TableHead><TableHead>Ficha</TableHead><TableHead className="text-right">Qtde</TableHead><TableHead className="text-right">OS</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
              <TableBody>
                {(orders ?? []).map(o => (
                  <TableRow key={o.id}>
                    <TableCell className="font-mono text-xs">{opNumber(o.number)}{o.parentOrderId && <span className="ml-1 text-muted-foreground">(parte)</span>}
                      {o.urgent && <Badge variant="destructive" className="ml-1">Urgente</Badge>}</TableCell>
                    <TableCell className="text-sm">{originLabel(o.origin, o.salesOrderNumber)}</TableCell>
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
