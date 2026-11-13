'use client';

import * as React from 'react';
import { ArrowDown, ArrowUp, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { subscribeOperation } from '@/lib/operation-client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import * as svc from '@/services/engineering-service';
import type {
  EngineeringSnapshot, ProductSheetComponent, ProductSheetStep, ProductSheetSummary, SheetInput, SheetStatus,
} from '@/server/persistence/pcp-engineering-contract';

const STATUSES: { value: SheetStatus; label: string }[] = [
  { value: 'aberto', label: 'Aberto' }, { value: 'aberto_avulso', label: 'Aberto avulso' }, { value: 'bloqueado', label: 'Bloqueado' },
  { value: 'suspenso', label: 'Suspenso' }, { value: 'versao_revisada', label: 'Versão revisada' }, { value: 'fechado', label: 'Fechado' },
  { value: 'amostra', label: 'Amostra' },
];
const selectClass = 'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm';
const emptySheet = (lineId: string | null): SheetInput => ({
  code: '', sku: '', name: '', status: 'aberto', baseQuantity: 1, lineId, steps: [], components: [],
});

/** Fichas técnicas: o roteiro de operações e os componentes de cada produto. */
export function SheetsTab({ data, isAdmin }: { data: EngineeringSnapshot; isAdmin: boolean }) {
  const { toast } = useToast();
  const [sheets, setSheets] = React.useState<ProductSheetSummary[] | null>(null);
  const [search, setSearch] = React.useState('');
  const [editing, setEditing] = React.useState<{ id: string | null; value: SheetInput } | null>(null);
  const [loadingId, setLoadingId] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const operationName = React.useMemo(() => new Map(data.operations.map(o => [o.id, o.name])), [data.operations]);

  React.useEffect(() => subscribeOperation(svc.getSheets, setSheets,
    e => toast({ variant: 'destructive', title: 'Erro ao carregar fichas', description: e.message })), [toast]);

  const filtered = React.useMemo(() => {
    const term = search.trim().toLowerCase();
    return (sheets ?? []).filter(s => !term || [s.code, s.sku, s.name].some(v => v.toLowerCase().includes(term)));
  }, [sheets, search]);

  const open = async (id: string | null) => {
    if (!id) { setEditing({ id: null, value: emptySheet(data.lines[0]?.id ?? null) }); return; }
    setLoadingId(id);
    try {
      const sheet = await svc.getSheet(id);
      setEditing({ id, value: { code: sheet.code, sku: sheet.sku, name: sheet.name, status: sheet.status, baseQuantity: sheet.baseQuantity,
        lineId: sheet.lineId, steps: sheet.steps, components: sheet.components } });
    } catch (e) {
      toast({ variant: 'destructive', title: 'Erro ao abrir a ficha', description: e instanceof Error ? e.message : undefined });
    } finally { setLoadingId(null); }
  };

  const update = (patch: Partial<SheetInput>) => setEditing(current => (current ? { ...current, value: { ...current.value, ...patch } } : current));
  const steps = editing?.value.steps ?? [];
  const setSteps = (next: ProductSheetStep[]) => {
    // Ao tirar um passo, some também como predecessora e como passo dos componentes.
    const ids = new Set(next.map(s => s.operationId));
    update({
      steps: next.map(s => (s.predecessorOperationId && !ids.has(s.predecessorOperationId) ? { ...s, predecessorOperationId: null } : s)),
      components: (editing?.value.components ?? []).map(c => (c.operationId && !ids.has(c.operationId) ? { ...c, operationId: null } : c)),
    });
  };
  const addStep = (operationId: string) => {
    if (!operationId || steps.some(s => s.operationId === operationId)) return;
    // Por padrão, a predecessora é o passo anterior: é o caso comum do roteiro em sequência.
    setSteps([...steps, { operationId, predecessorOperationId: steps.at(-1)?.operationId ?? null, plannedMinutes: null, notes: null }]);
  };
  const move = (index: number, delta: number) => {
    const next = [...steps]; [next[index], next[index + delta]] = [next[index + delta], next[index]]; setSteps(next);
  };
  const components = editing?.value.components ?? [];
  const setComponents = (next: ProductSheetComponent[]) => update({ components: next });

  const save = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      await svc.saveSheet(editing.id, {
        ...editing.value,
        components: editing.value.components.filter(c => c.componentSku.trim()),
      });
      toast({ title: 'Ficha salva.' });
      setEditing(null);
    } catch (e) {
      toast({ variant: 'destructive', title: 'Não foi possível salvar', description: e instanceof Error ? e.message : undefined });
    } finally { setSaving(false); }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Input className="max-w-sm" placeholder="Buscar por código, SKU ou nome" value={search} onChange={e => setSearch(e.target.value)} />
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">{sheets ? `${filtered.length} de ${sheets.length} fichas` : 'Carregando...'}</span>
          {isAdmin && <Button size="sm" onClick={() => open(null)}><Plus className="mr-1 h-4 w-4" />Nova ficha</Button>}
        </div>
      </div>
      <Table>
        <TableHeader><TableRow><TableHead>Código</TableHead><TableHead>SKU</TableHead><TableHead>Produto</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Operações</TableHead><TableHead className="text-right">Componentes</TableHead><TableHead /></TableRow></TableHeader>
        <TableBody>
          {filtered.slice(0, 200).map(s => (
            <TableRow key={s.id}>
              <TableCell className="font-mono text-xs">{s.code}</TableCell><TableCell className="font-mono text-xs">{s.sku}</TableCell>
              <TableCell>{s.name}</TableCell><TableCell><Badge variant="outline">{STATUSES.find(x => x.value === s.status)?.label}</Badge></TableCell>
              <TableCell className="text-right">{s.stepCount}</TableCell><TableCell className="text-right">{s.componentCount}</TableCell>
              <TableCell>
                <Button variant="ghost" size="icon" aria-label={isAdmin ? 'Editar ficha' : 'Ver ficha'} disabled={loadingId === s.id} onClick={() => open(s.id)}>
                  {loadingId === s.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pencil className="h-4 w-4" />}
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {filtered.length > 200 && <p className="text-sm text-muted-foreground">Mostrando 200 fichas. Refine a busca para ver as demais.</p>}

      <Dialog open={editing !== null} onOpenChange={o => !o && setEditing(null)}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader><DialogTitle>{editing?.id ? `Ficha ${editing.value.code}` : 'Nova ficha técnica'}</DialogTitle></DialogHeader>
          {editing && (
            <fieldset disabled={!isAdmin} className="space-y-4">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <div className="space-y-1"><Label>Código (iApp)</Label><Input value={editing.value.code} onChange={e => update({ code: e.target.value })} /></div>
                <div className="space-y-1"><Label>SKU</Label><Input value={editing.value.sku} onChange={e => update({ sku: e.target.value })} /></div>
                <div className="space-y-1"><Label>Status</Label>
                  <select className={selectClass} value={editing.value.status} onChange={e => update({ status: e.target.value as SheetStatus })}>
                    {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}</select></div>
                <div className="space-y-1"><Label>Quantidade base</Label><Input type="number" min={0} step="any" value={editing.value.baseQuantity} onChange={e => update({ baseQuantity: Number(e.target.value) })} /></div>
              </div>
              <div className="space-y-1"><Label>Nome</Label><Input value={editing.value.name} onChange={e => update({ name: e.target.value })} /></div>

              <div className="space-y-2">
                <Label>Roteiro de operações</Label>
                {steps.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma operação no roteiro.</p>}
                {steps.map((step, i) => (
                  <div key={step.operationId} className="flex flex-wrap items-center gap-2 rounded-md border p-2">
                    <span className="w-6 text-sm text-muted-foreground">{i + 1}.</span>
                    <span className="min-w-36 flex-1 text-sm font-medium">{operationName.get(step.operationId) ?? 'Operação removida'}</span>
                    <select className="h-8 rounded border bg-transparent px-1 text-xs" aria-label="Predecessora" value={step.predecessorOperationId ?? ''}
                      onChange={e => setSteps(steps.map((s, j) => (j === i ? { ...s, predecessorOperationId: e.target.value || null } : s)))}>
                      <option value="">Sem predecessora</option>
                      {steps.filter(s => s.operationId !== step.operationId).map(s => <option key={s.operationId} value={s.operationId}>Depois de {operationName.get(s.operationId)}</option>)}
                    </select>
                    <Input className="h-8 w-28" type="number" min={0} step="any" placeholder="Min. previstos" aria-label="Minutos previstos"
                      value={step.plannedMinutes ?? ''} onChange={e => setSteps(steps.map((s, j) => (j === i ? { ...s, plannedMinutes: e.target.value === '' ? null : Number(e.target.value) } : s)))} />
                    {isAdmin && <>
                      <Button variant="ghost" size="icon" disabled={i === 0} aria-label="Subir" onClick={() => move(i, -1)}><ArrowUp className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="icon" disabled={i === steps.length - 1} aria-label="Descer" onClick={() => move(i, 1)}><ArrowDown className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="icon" aria-label="Remover passo" onClick={() => setSteps(steps.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
                    </>}
                  </div>
                ))}
                {isAdmin && (
                  <select className={selectClass} aria-label="Adicionar operação" value="" onChange={e => addStep(e.target.value)}>
                    <option value="">Adicionar operação ao roteiro...</option>
                    {data.operations.filter(o => o.active && !steps.some(s => s.operationId === o.id)).map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                )}
              </div>

              <div className="space-y-2">
                <Label>Componentes (estrutura do produto)</Label>
                {components.map((c, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-2">
                    <Input className="h-8 w-36" placeholder="SKU" aria-label="SKU do componente" value={c.componentSku}
                      onChange={e => setComponents(components.map((x, j) => (j === i ? { ...x, componentSku: e.target.value } : x)))} />
                    <Input className="h-8 min-w-40 flex-1" placeholder="Descrição" aria-label="Descrição do componente" value={c.componentName ?? ''}
                      onChange={e => setComponents(components.map((x, j) => (j === i ? { ...x, componentName: e.target.value || null } : x)))} />
                    <Input className="h-8 w-24" type="number" min={0} step="any" aria-label="Quantidade" value={c.quantity}
                      onChange={e => setComponents(components.map((x, j) => (j === i ? { ...x, quantity: Number(e.target.value) } : x)))} />
                    <select className="h-8 rounded border bg-transparent px-1 text-xs" aria-label="Passo do componente" value={c.operationId ?? ''}
                      onChange={e => setComponents(components.map((x, j) => (j === i ? { ...x, operationId: e.target.value || null } : x)))}>
                      <option value="">Sem passo</option>
                      {steps.map(s => <option key={s.operationId} value={s.operationId}>{operationName.get(s.operationId)}</option>)}
                    </select>
                    {isAdmin && <Button variant="ghost" size="icon" aria-label="Remover componente" onClick={() => setComponents(components.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>}
                  </div>
                ))}
                {isAdmin && <Button variant="outline" size="sm" onClick={() => setComponents([...components, { componentSku: '', componentName: null, quantity: 1, operationId: steps[0]?.operationId ?? null }])}><Plus className="mr-1 h-4 w-4" />Componente</Button>}
              </div>
            </fieldset>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>{isAdmin ? 'Cancelar' : 'Fechar'}</Button>
            {isAdmin && <Button onClick={save} disabled={saving}>{saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Salvar</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
