'use client';

import * as React from 'react';
import { ArrowRight, ChevronDown, ChevronUp, Loader2, Play, Search, Square } from 'lucide-react';
import DashboardLayout from '@/components/dashboard-layout';
import { useToast } from '@/hooks/use-toast';
import { subscribeOperation } from '@/lib/operation-client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import * as svc from '@/services/production-kanban-service';
import { formatMinutes } from '@/lib/pcp/business-time';
import type { Board, BoardCard } from '@/server/persistence/pcp-kanban-contract';

const STEP_STYLE: Record<string, string> = {
  executada: 'bg-green-100 text-green-800 border-green-200 dark:bg-green-950 dark:text-green-200',
  em_execucao: 'bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-950 dark:text-amber-200',
  aberto: 'bg-muted text-muted-foreground border-transparent',
};
const STEP_LABEL: Record<string, string> = { executada: 'executada', em_execucao: 'em execução', aberto: 'aberta' };
const fmt = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
/** Número da OP: o do iApp, quando ela veio de lá, porque é o que a equipe conhece. */
const opLabel = (card: { number: number; iappNumber: string | null }) => card.iappNumber ?? String(card.number).padStart(7, '0');
const time = (iso: string | null) => (iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');

function CardView({ card, board, busy, act, openFinish }: {
  card: BoardCard; board: Board; busy: string | null; act: (key: string, run: () => Promise<void>, done: string) => void;
  openFinish: (card: BoardCard) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [worker, setWorker] = React.useState('');
  const columnName = (key: string) => board.columns.find(c => c.key === key)?.name ?? key;
  const running = card.steps.find(s => s.status === 'em_execucao');
  const start = card.allowed.start;
  const lost = card.quantity - card.currentQuantity;
  return (
    <div className="space-y-2 rounded-md border bg-card p-3 text-sm shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs font-semibold">{opLabel(card)}{card.iappNumber && <span className="ml-1 font-sans text-[10px] font-normal text-muted-foreground">iApp</span>}</span>
        <Badge variant="outline" className="text-[10px]">{card.kind === 'corte' ? 'Corte' : 'Semanal'}</Badge>
      </div>
      <div className="font-medium leading-snug" title={card.description ?? card.sku}>{card.description ?? card.sku}</div>
      <div className="font-mono text-xs text-muted-foreground">{card.sku}</div>
      <div className="text-xs">
        Qtde <strong>{fmt(card.currentQuantity)}</strong>
        {lost > 0 && <span className="ml-2 text-destructive">· perda {fmt(lost)}</span>}
      </div>
      {running && <div className="text-xs text-amber-700 dark:text-amber-300">{running.imported
        ? <>{running.operationName}: em execução (iniciada no iApp)</>
        : <>{running.operationName}: {running.workerName} desde {time(running.startedAt)} · {formatMinutes(running.runMinutes)} úteis</>}</div>}
      <div className="flex flex-wrap gap-1">
        {card.steps.map(s => <span key={s.id} title={`${s.operationName}: ${STEP_LABEL[s.status]}`} className={`rounded border px-1.5 py-0.5 text-[10px] ${STEP_STYLE[s.status]}`}>{s.operationName}</span>)}
      </div>

      {start && (
        <div className="flex gap-1">
          <select className="h-8 min-w-0 flex-1 rounded border bg-transparent px-1 text-xs" aria-label={`Quem executa a OP ${card.number}`} value={worker} onChange={e => setWorker(e.target.value)}>
            <option value="">Quem executa...</option>
            {start.workers.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
          <Button size="sm" className="h-8" disabled={!worker || busy !== null}
            onClick={() => act(`start-${card.id}`, () => svc.startStep(card.id, start.stepId, worker), 'OS iniciada.')}>
            {busy === `start-${card.id}` ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}<span className="ml-1">Iniciar</span>
          </Button>
        </div>
      )}
      {card.allowed.finishStepId && (
        <Button size="sm" variant="secondary" className="h-8 w-full" disabled={busy !== null} onClick={() => openFinish(card)}>
          <Square className="mr-1 h-3 w-3" />Finalizar {running?.operationName}
        </Button>
      )}
      {card.allowed.moveTo && (
        <Button size="sm" variant="outline" className="h-8 w-full" disabled={busy !== null}
          onClick={() => act(`move-${card.id}`, () => svc.moveCard(card.id, card.allowed.moveTo!), 'Card movido.')}>
          {busy === `move-${card.id}` ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <ArrowRight className="mr-1 h-3 w-3" />}Passar para {columnName(card.allowed.moveTo)}
        </Button>
      )}

      <button type="button" className="flex w-full items-center justify-center gap-1 text-xs text-muted-foreground hover:text-foreground" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}Detalhes
      </button>
      {open && (
        <div className="space-y-1 border-t pt-2 text-xs">
          {card.steps.map(s => (
            <div key={s.id}>
              <span className="font-medium">{s.position + 1}. {s.operationName}</span> · {STEP_LABEL[s.status]}
              {s.workerName && <> · {s.workerName}</>}
              {s.imported && !s.workerName && <> · no iApp</>}
              {s.startedAt && <> · {time(s.startedAt)}{s.finishedAt && <> → {time(s.finishedAt)}</>}</>}
              {(s.waitMinutes !== null || s.runMinutes !== null) && (
                <div className="text-muted-foreground">
                  {s.waitMinutes !== null && <>espera {formatMinutes(s.waitMinutes)}</>}
                  {s.waitMinutes !== null && s.runMinutes !== null && ' · '}
                  {s.runMinutes !== null && <>execução {formatMinutes(s.runMinutes)}{s.status === 'em_execucao' && ' (em andamento)'}</>}
                </div>
              )}
              {s.notes && <div className="text-muted-foreground">“{s.notes}”</div>}
            </div>
          ))}
          {card.losses.map((l, i) => <div key={i} className="text-destructive">Perda de {fmt(l.quantity)}: {l.reason}{l.notes ? ` (${l.notes})` : ''}</div>)}
          <div className="border-t pt-1 font-medium">
            Balanço: previsto {fmt(card.quantity)} · atual {fmt(card.currentQuantity)} · perdas {fmt(card.quantity - card.currentQuantity)}
            <div className="font-normal text-muted-foreground">Tempo útil: execução {formatMinutes(card.totals.runMinutes)} · espera {formatMinutes(card.totals.waitMinutes)}</div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function BoardClient() {
  const { toast } = useToast();
  const [board, setBoard] = React.useState<Board | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [search, setSearch] = React.useState('');
  const [finishing, setFinishing] = React.useState<BoardCard | null>(null);
  const [loss, setLoss] = React.useState({ quantity: 0, reasonId: '', notes: '' });

  React.useEffect(() => subscribeOperation(svc.getBoard, b => { setBoard(b); setError(null); }, e => setError(e.message)), []);

  const act = (key: string, run: () => Promise<void>, done: string) => {
    setBusy(key);
    run().then(() => toast({ title: done }))
      .catch(e => toast({ variant: 'destructive', title: 'Não foi possível concluir', description: e instanceof Error ? e.message : undefined }))
      .finally(() => setBusy(null));
  };
  const openFinish = (card: BoardCard) => { setLoss({ quantity: 0, reasonId: '', notes: '' }); setFinishing(card); };
  const confirmFinish = () => {
    if (!finishing?.allowed.finishStepId) return;
    const card = finishing;
    act(`finish-${card.id}`, async () => {
      await svc.finishStep(card.id, card.allowed.finishStepId!, { lossQuantity: Number(loss.quantity) || 0, lossReasonId: loss.reasonId || null, notes: loss.notes.trim() || null });
      setFinishing(null);
    }, 'OS finalizada.');
  };

  if (error && !board) return <DashboardLayout><div className="p-6 text-destructive">{error}</div></DashboardLayout>;
  if (!board) return <DashboardLayout><div className="flex items-center gap-2 p-6"><Loader2 className="h-4 w-4 animate-spin" />Carregando...</div></DashboardLayout>;

  const term = search.trim().toLowerCase();
  const cards = board.cards.filter(c => !term || [String(c.number), c.iappNumber ?? '', c.sku, c.description ?? ''].some(v => v.toLowerCase().includes(term)));

  return (
    <DashboardLayout>
      <div className="space-y-3 p-4 md:p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Kanban de OPs</h1>
            <p className="text-sm text-muted-foreground">
              {board.actorWorker ? <>Você age como <strong>{board.actorWorker.name}</strong>.</> : 'Seu usuário não está vinculado a um funcionário: só administradores agem sem vínculo.'}
              {' '}O card só passa de fase quando a OS terminou, e quem passa é o líder da fase.
            </p>
          </div>
          <div className="relative w-64"><Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input className="pl-8" placeholder="Buscar OP, SKU ou produto" value={search} onChange={e => setSearch(e.target.value)} /></div>
        </div>
        <div className="flex gap-3 overflow-x-auto pb-3">
          {board.columns.map(column => {
            const inColumn = cards.filter(c => c.column === column.key);
            return (
              <div key={column.key} className="flex w-64 shrink-0 flex-col gap-2 rounded-lg bg-muted/40 p-2">
                <div className="flex items-center justify-between px-1 text-sm font-semibold"><span>{column.name}</span><Badge variant="secondary">{inColumn.length}</Badge></div>
                {inColumn.map(card => <CardView key={card.id} card={card} board={board} busy={busy} act={act} openFinish={openFinish} />)}
              </div>
            );
          })}
        </div>
      </div>

      <Dialog open={finishing !== null} onOpenChange={o => !o && setFinishing(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Finalizar OS da OP {finishing ? opLabel(finishing) : ''}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Quantidade atual: {finishing ? fmt(finishing.currentQuantity) : ''}. Lance a perda, se houve, e o motivo.</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label htmlFor="loss-qty">Perda (unidades)</Label>
                <Input id="loss-qty" type="number" min={0} value={loss.quantity} onChange={e => setLoss(l => ({ ...l, quantity: Number(e.target.value) }))} /></div>
              <div className="space-y-1"><Label htmlFor="loss-reason">Motivo</Label>
                <select id="loss-reason" className="flex h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm" disabled={!loss.quantity}
                  value={loss.reasonId} onChange={e => setLoss(l => ({ ...l, reasonId: e.target.value }))}>
                  <option value="">Selecione...</option>{board.lossReasons.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select></div>
            </div>
            <div className="space-y-1"><Label htmlFor="step-notes">Observações (seguem com a OP)</Label>
              <Textarea id="step-notes" rows={3} value={loss.notes} onChange={e => setLoss(l => ({ ...l, notes: e.target.value }))} /></div>
            {board.lossReasons.length === 0 && <p className="text-xs text-amber-600">Nenhum motivo de perda cadastrado: cadastre em Engenharia → Motivos de perda.</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFinishing(null)}>Cancelar</Button>
            <Button onClick={confirmFinish} disabled={busy !== null || (loss.quantity > 0 && !loss.reasonId)}>{busy?.startsWith('finish') && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Finalizar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
