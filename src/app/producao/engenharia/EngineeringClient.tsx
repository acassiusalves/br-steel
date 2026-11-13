'use client';

import * as React from 'react';
import { Loader2, Pencil, Plus, Trash2, ArrowUp, ArrowDown } from 'lucide-react';
import DashboardLayout from '@/components/dashboard-layout';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { subscribeOperation } from '@/lib/operation-client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import * as svc from '@/services/engineering-service';
import { getAssignableUsers } from '@/services/user-service';
import { SheetsTab } from './SheetsTab';
import type {
  EngineeringSnapshot, ProductionLine, ProductionOperation, TeamMemberRow, WorkTeam, Worker, WorkPeriodRow,
} from '@/server/persistence/pcp-engineering-contract';

const WEEKDAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const selectClass = 'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm';

type Editing =
  | { kind: 'line'; value: ProductionLine | null }
  | { kind: 'operation'; value: ProductionOperation | null }
  | { kind: 'team'; value: WorkTeam | null }
  | { kind: 'worker'; value: Worker | null }
  | null;

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1"><Label>{label}</Label>{children}</div>;
}

/** Lista de operações marcáveis, usada em equipes e funcionários. */
function OperationPicker({ operations, value, onChange }: { operations: ProductionOperation[]; value: string[]; onChange: (ids: string[]) => void }) {
  return (
    <div className="grid max-h-48 grid-cols-2 gap-1 overflow-y-auto rounded-md border p-2">
      {operations.map(op => (
        <label key={op.id} className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={value.includes(op.id)}
            onChange={e => onChange(e.target.checked ? [...value, op.id] : value.filter(id => id !== op.id))} />
          {op.name}
        </label>
      ))}
    </div>
  );
}

/** Organograma da equipe: quem participa e a quem cada um responde dentro dela. */
function MembersEditor({ workers, value, onChange }: { workers: Worker[]; value: TeamMemberRow[]; onChange: (members: TeamMemberRow[]) => void }) {
  const inTeam = new Set(value.map(m => m.workerId));
  // Quem já é membro aparece primeiro. A ordem é fixada ao abrir, para a lista não pular a cada clique.
  const [order] = React.useState(() => [...workers].sort((a, b) => Number(inTeam.has(b.id)) - Number(inTeam.has(a.id))));
  return (
    <div className="max-h-56 space-y-1 overflow-y-auto rounded-md border p-2">
      {order.map(w => {
        const member = value.find(m => m.workerId === w.id);
        return (
          <div key={w.id} className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={Boolean(member)} aria-label={`Membro: ${w.name}`}
              onChange={e => onChange(e.target.checked ? [...value, { workerId: w.id, leaderId: null }]
                : value.filter(m => m.workerId !== w.id).map(m => (m.leaderId === w.id ? { ...m, leaderId: null } : m)))} />
            <span className={`flex-1 ${w.active ? '' : 'text-muted-foreground'}`}>{w.name}</span>
            {member && <select className="h-7 rounded border bg-transparent px-1 text-xs" aria-label={`Superior de ${w.name}`} value={member.leaderId ?? ''}
              onChange={e => onChange(value.map(m => (m.workerId === w.id ? { ...m, leaderId: e.target.value || null } : m)))}>
              <option value="">Responde a ninguém</option>
              {workers.filter(o => o.id !== w.id && inTeam.has(o.id)).map(o => <option key={o.id} value={o.id}>Responde a {o.name}</option>)}
            </select>}
          </div>
        );
      })}
    </div>
  );
}

export default function EngineeringClient() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [data, setData] = React.useState<EngineeringSnapshot | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState<Editing>(null);
  const [form, setForm] = React.useState<Record<string, unknown>>({});
  const [saving, setSaving] = React.useState(false);
  const [users, setUsers] = React.useState<{ id: string; name: string; role: string; badge?: string }[]>([]);
  const isAdmin = user?.role === 'Administrador';

  // Usuários de login, para vincular ao funcionário: é por esse vínculo que ele age no Kanban de OPs.
  const loadUsers = React.useCallback(() => { if (isAdmin) void getAssignableUsers().then(setUsers).catch(() => setUsers([])); }, [isAdmin]);
  React.useEffect(loadUsers, [loadUsers]);

  React.useEffect(() => subscribeOperation(svc.getEngineering,
    snapshot => { setData(snapshot); setError(null); },
    e => setError(e.message || 'Falha ao carregar.')), []);

  const names = React.useMemo(() => {
    const map = new Map<string, string>();
    data?.lines.forEach(l => l.phases.forEach(p => map.set(p.id, p.name)));
    data?.operations.forEach(o => map.set(o.id, o.name));
    data?.workers.forEach(w => map.set(w.id, w.name));
    data?.teams.forEach(t => map.set(t.id, t.name));
    return map;
  }, [data]);
  const name = (id: string | null) => (id ? names.get(id) ?? '—' : '—');

  const open = (next: Editing) => {
    setEditing(next);
    if (!next) return;
    const v = next.value as Record<string, unknown> | null;
    const defaults: Record<string, Record<string, unknown>> = {
      line: { name: '', monthlyCapacity: 0, active: true, phases: [{ name: '' }] },
      operation: { code: '', name: '', phaseId: data?.lines[0]?.phases[0]?.id ?? '', position: 0, predecessorId: null, location: 'interno', classification: null, defaultWorkerId: null, active: true },
      team: { name: '', status: 'aberto', shift: 'integral', leaderId: null, operationIds: [], members: [] },
      worker: { name: '', badge: '', kind: '', active: true, userId: null, operationIds: [] },
    };
    setForm(v ? { ...v, phases: next.kind === 'line' ? (next.value as ProductionLine).phases.map(p => ({ id: p.id, name: p.name })) : undefined } : defaults[next.kind]);
  };
  const set = (key: string, value: unknown) => setForm(f => ({ ...f, [key]: value }));
  const run = async (action: () => Promise<unknown>, done = 'Salvo.') => {
    setSaving(true);
    try { await action(); toast({ title: done }); setEditing(null); }
    catch (e) { toast({ variant: 'destructive', title: 'Não foi possível salvar', description: e instanceof Error ? e.message : undefined }); }
    finally { setSaving(false); }
  };

  const save = () => {
    if (!editing) return;
    const id = (editing.value as { id?: string } | null)?.id ?? null;
    const f = form;
    const orNull = (v: unknown) => (v === '' || v === undefined ? null : v);
    switch (editing.kind) {
      case 'line':
        return run(() => svc.saveLine(id, { name: String(f.name), monthlyCapacity: Number(f.monthlyCapacity) || 0, active: Boolean(f.active),
          phases: (f.phases as { id?: string; name: string }[]).filter(p => p.name.trim()) }));
      case 'operation':
        return run(() => svc.saveOperation(id, { code: String(f.code), name: String(f.name), phaseId: String(f.phaseId), position: Number(f.position) || 0,
          predecessorId: orNull(f.predecessorId) as string | null, location: f.location as 'interno', classification: orNull(f.classification) as string | null,
          defaultWorkerId: orNull(f.defaultWorkerId) as string | null, active: Boolean(f.active) }));
      case 'team':
        return run(() => svc.saveTeam(id, { name: String(f.name), status: f.status as 'aberto', shift: f.shift as 'integral',
          leaderId: orNull(f.leaderId) as string | null, operationIds: f.operationIds as string[], members: f.members as TeamMemberRow[] }));
      case 'worker':
        return run(() => svc.saveWorker(id, { name: String(f.name), badge: String(f.badge), kind: String(f.kind), active: Boolean(f.active),
          userId: orNull(f.userId) as string | null, operationIds: f.operationIds as string[] }));
    }
  };

  if (error && !data) return <DashboardLayout><div className="p-6 text-destructive">{error}</div></DashboardLayout>;
  if (!data) return <DashboardLayout><div className="flex items-center gap-2 p-6"><Loader2 className="h-4 w-4 animate-spin" />Carregando...</div></DashboardLayout>;

  const phases = data.lines.flatMap(l => l.phases.map(p => ({ ...p, lineName: l.name })));
  const editButton = (next: Editing) => isAdmin && (
    <Button variant="ghost" size="icon" aria-label="Editar" onClick={() => open(next)}><Pencil className="h-4 w-4" /></Button>
  );
  const newButton = (next: Editing, label: string) => isAdmin && (
    <Button size="sm" onClick={() => open(next)}><Plus className="mr-1 h-4 w-4" />{label}</Button>
  );
  const status = (active: boolean) => <Badge variant={active ? 'default' : 'secondary'}>{active ? 'Ativo' : 'Inativo'}</Badge>;

  return (
    <DashboardLayout>
      <div className="space-y-4 p-4 md:p-6">
        <div>
          <h1 className="text-2xl font-semibold">Engenharia da produção</h1>
          <p className="text-sm text-muted-foreground">Linha, fases, operações, equipes, funcionários, fichas técnicas e expediente usados no Kanban de produção.</p>
        </div>
        <Tabs defaultValue="linha">
          <TabsList className="flex-wrap">
            <TabsTrigger value="linha">Linha e fases</TabsTrigger>
            <TabsTrigger value="operacoes">Operações</TabsTrigger>
            <TabsTrigger value="equipes">Equipes</TabsTrigger>
            <TabsTrigger value="funcionarios">Funcionários</TabsTrigger>
            <TabsTrigger value="fichas">Fichas técnicas</TabsTrigger>
            <TabsTrigger value="expediente">Expediente</TabsTrigger>
            <TabsTrigger value="perdas">Motivos de perda</TabsTrigger>
          </TabsList>

          <TabsContent value="linha" className="space-y-3">
            <div className="flex justify-end">{newButton({ kind: 'line', value: null }, 'Nova linha')}</div>
            {data.lines.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma linha cadastrada.</p>}
            {data.lines.map(line => (
              <Card key={line.id}>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-base">{line.name} <span className="text-sm font-normal text-muted-foreground">· {line.monthlyCapacity} un/mês</span> {status(line.active)}</CardTitle>
                  {editButton({ kind: 'line', value: line })}
                </CardHeader>
                <CardContent className="flex flex-wrap gap-2">
                  {line.phases.map((p, i) => <Badge key={p.id} variant="outline">{i + 1}. {p.name}</Badge>)}
                </CardContent>
              </Card>
            ))}
          </TabsContent>

          <TabsContent value="operacoes" className="space-y-3">
            <div className="flex justify-end">{phases.length > 0 && newButton({ kind: 'operation', value: null }, 'Nova operação')}</div>
            <Table>
              <TableHeader><TableRow><TableHead>Código</TableHead><TableHead>Operação</TableHead><TableHead>Fase</TableHead><TableHead>Predecessora</TableHead><TableHead>Funcionário padrão</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader>
              <TableBody>
                {data.operations.map(op => (
                  <TableRow key={op.id}>
                    <TableCell className="font-mono text-xs">{op.code}</TableCell><TableCell>{op.name}</TableCell><TableCell>{name(op.phaseId)}</TableCell>
                    <TableCell>{name(op.predecessorId)}</TableCell><TableCell>{name(op.defaultWorkerId)}</TableCell><TableCell>{status(op.active)}</TableCell>
                    <TableCell>{editButton({ kind: 'operation', value: op })}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TabsContent>

          <TabsContent value="equipes" className="space-y-3">
            <div className="flex justify-end">{newButton({ kind: 'team', value: null }, 'Nova equipe')}</div>
            <Table>
              <TableHeader><TableRow><TableHead>Equipe</TableHead><TableHead>Líder</TableHead><TableHead>Membros</TableHead><TableHead>Operações</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader>
              <TableBody>
                {data.teams.map(team => (
                  <TableRow key={team.id}>
                    <TableCell>{team.name}</TableCell><TableCell>{name(team.leaderId)}</TableCell>
                    <TableCell>{team.members.length}</TableCell>
                    <TableCell className="text-xs">{team.operationIds.map(name).join(', ') || '—'}</TableCell>
                    <TableCell><Badge variant="outline">{team.status}</Badge></TableCell><TableCell>{editButton({ kind: 'team', value: team })}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TabsContent>

          <TabsContent value="funcionarios" className="space-y-3">
            <div className="flex justify-end">{newButton({ kind: 'worker', value: null }, 'Novo funcionário')}</div>
            <Table>
              <TableHeader><TableRow><TableHead>Crachá</TableHead><TableHead>Nome</TableHead><TableHead>Tipo</TableHead><TableHead>Equipes</TableHead><TableHead>Login</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader>
              <TableBody>
                {data.workers.map(w => (
                  <TableRow key={w.id}>
                    <TableCell className="font-mono text-xs">{w.badge}</TableCell><TableCell>{w.name}</TableCell><TableCell>{w.kind}</TableCell>
                    <TableCell className="text-xs">{data.teams.filter(t => t.members.some(m => m.workerId === w.id)).map(t => t.name).join(', ') || '—'}</TableCell><TableCell className="text-xs">{w.userId ? (users.find(u => u.id === w.userId)?.badge ? 'Crachá' : users.find(u => u.id === w.userId)?.name ?? 'Vinculado') : '—'}</TableCell><TableCell>{status(w.active)}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {editButton({ kind: 'worker', value: w })}
                      {isAdmin && !w.userId && w.badge && (
                        <Button size="sm" variant="outline" className="ml-2" disabled={saving}
                          onClick={() => window.confirm(`Criar o acesso de ${w.name} pelo crachá ${w.badge}? No primeiro acesso a senha é 123456 e ele cadastra a senha pessoal.`)
                            && void run(() => svc.createBadgeAccess(w.id).then(loadUsers), `Acesso criado. Primeiro acesso: crachá ${w.badge} e senha 123456.`)}>
                          Criar acesso pelo crachá
                        </Button>
                      )}
                      {isAdmin && w.userId && users.find(u => u.id === w.userId)?.badge && (
                        <Button size="sm" variant="outline" className="ml-2" disabled={saving}
                          onClick={() => window.confirm(`Resetar a senha de ${w.name}? Ele volta a entrar com 123456 e cadastra uma senha nova. As sessões abertas dele serão encerradas.`)
                            && void run(() => svc.resetBadgePassword(w.id), `Senha resetada. ${w.name} entra com o crachá e a senha 123456.`)}>
                          Resetar senha
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TabsContent>

          <TabsContent value="fichas"><SheetsTab data={data} isAdmin={isAdmin} /></TabsContent>
          <TabsContent value="expediente"><WorkCalendar data={data} isAdmin={isAdmin} run={run} saving={saving} /></TabsContent>
          <TabsContent value="perdas"><LossReasons data={data} isAdmin={isAdmin} run={run} /></TabsContent>
        </Tabs>
      </div>

      <Dialog open={editing !== null} onOpenChange={o => !o && setEditing(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editing?.value ? 'Editar' : 'Novo cadastro'}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            {editing && <Field label="Nome"><Input value={String(form.name ?? '')} onChange={e => set('name', e.target.value)} /></Field>}
            {editing?.kind === 'line' && <>
              <Field label="Capacidade (un/mês)"><Input type="number" value={String(form.monthlyCapacity ?? 0)} onChange={e => set('monthlyCapacity', e.target.value)} /></Field>
              <Field label="Fases, na ordem do Kanban">
                <div className="space-y-1">
                  {(form.phases as { id?: string; name: string }[] ?? []).map((p, i, list) => (
                    <div key={p.id ?? `new-${i}`} className="flex gap-1">
                      <Input value={p.name} onChange={e => set('phases', list.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                      <Button variant="ghost" size="icon" disabled={i === 0} aria-label="Subir" onClick={() => { const n = [...list]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; set('phases', n); }}><ArrowUp className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="icon" disabled={i === list.length - 1} aria-label="Descer" onClick={() => { const n = [...list]; [n[i + 1], n[i]] = [n[i], n[i + 1]]; set('phases', n); }}><ArrowDown className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="icon" aria-label="Remover" onClick={() => set('phases', list.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  ))}
                  <Button variant="outline" size="sm" onClick={() => set('phases', [...(form.phases as unknown[] ?? []), { name: '' }])}><Plus className="mr-1 h-4 w-4" />Fase</Button>
                </div>
              </Field>
            </>}
            {editing?.kind === 'operation' && <>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Código"><Input value={String(form.code ?? '')} onChange={e => set('code', e.target.value)} /></Field>
                <Field label="Ordem na fase"><Input type="number" value={String(form.position ?? 0)} onChange={e => set('position', e.target.value)} /></Field>
              </div>
              <Field label="Fase"><select className={selectClass} value={String(form.phaseId ?? '')} onChange={e => set('phaseId', e.target.value)}>
                {phases.map(p => <option key={p.id} value={p.id}>{p.lineName} · {p.name}</option>)}</select></Field>
              <Field label="Predecessora"><select className={selectClass} value={String(form.predecessorId ?? '')} onChange={e => set('predecessorId', e.target.value)}>
                <option value="">Nenhuma</option>
                {data.operations.filter(o => o.id !== (editing.value?.id)).map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></Field>
              <Field label="Funcionário padrão"><select className={selectClass} value={String(form.defaultWorkerId ?? '')} onChange={e => set('defaultWorkerId', e.target.value)}>
                <option value="">Nenhum</option>{data.workers.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Local"><select className={selectClass} value={String(form.location)} onChange={e => set('location', e.target.value)}><option value="interno">Interno</option><option value="externo">Externo</option></select></Field>
                <Field label="Classificação"><Input value={String(form.classification ?? '')} onChange={e => set('classification', e.target.value)} /></Field>
              </div>
            </>}
            {editing?.kind === 'team' && <>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Status"><select className={selectClass} value={String(form.status)} onChange={e => set('status', e.target.value)}><option value="aberto">Aberto</option><option value="inativo">Inativo</option><option value="fechado">Fechado</option></select></Field>
                <Field label="Turno"><select className={selectClass} value={String(form.shift)} onChange={e => set('shift', e.target.value)}><option value="manha">Manhã</option><option value="tarde">Tarde</option><option value="noite">Noite</option><option value="integral">Integral</option></select></Field>
              </div>
              <Field label="Membros e organograma"><MembersEditor workers={data.workers} value={form.members as TeamMemberRow[] ?? []}
                onChange={members => setForm(f => ({ ...f, members, leaderId: members.some(m => m.workerId === f.leaderId) ? f.leaderId : null }))} /></Field>
              <Field label="Líder (aprova a passagem do card)"><select className={selectClass} value={String(form.leaderId ?? '')} onChange={e => set('leaderId', e.target.value)}>
                <option value="">Nenhum</option>{(form.members as TeamMemberRow[] ?? []).map(m => <option key={m.workerId} value={m.workerId}>{name(m.workerId)}</option>)}</select></Field>
              <Field label="Operações da equipe"><OperationPicker operations={data.operations} value={form.operationIds as string[] ?? []} onChange={ids => set('operationIds', ids)} /></Field>
            </>}
            {editing?.kind === 'worker' && <>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Crachá"><Input value={String(form.badge ?? '')} onChange={e => set('badge', e.target.value)} /></Field>
                <Field label="Tipo (ex.: Dobrador)"><Input value={String(form.kind ?? '')} onChange={e => set('kind', e.target.value)} /></Field>
              </div>
              <Field label="Usuário de login (para agir no Kanban de OPs)"><select className={selectClass} value={String(form.userId ?? '')} onChange={e => set('userId', e.target.value || null)}>
                <option value="">Sem usuário</option>{users.map(u => <option key={u.id} value={u.id}>{u.name} · {u.role}</option>)}</select></Field>
              <Field label="Operações que pode iniciar"><OperationPicker operations={data.operations} value={form.operationIds as string[] ?? []} onChange={ids => set('operationIds', ids)} /></Field>
            </>}
            {editing && editing.kind !== 'team' && (
              <label className="flex items-center gap-2 text-sm"><Switch checked={Boolean(form.active)} onCheckedChange={v => set('active', v)} />Ativo</label>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancelar</Button>
            <Button onClick={save} disabled={saving}>{saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}

type RunFn = (action: () => Promise<unknown>, done?: string) => Promise<void>;

/** Expediente por dia da semana: cada linha é um intervalo de trabalho; os vãos são as pausas. */
function WorkCalendar({ data, isAdmin, run, saving }: { data: EngineeringSnapshot; isAdmin: boolean; run: RunFn; saving: boolean }) {
  const [periods, setPeriods] = React.useState<WorkPeriodRow[]>(data.workPeriods);
  const [holiday, setHoliday] = React.useState({ day: '', name: '' });
  React.useEffect(() => setPeriods(data.workPeriods), [data.workPeriods]);
  const update = (index: number, patch: Partial<WorkPeriodRow>) => setPeriods(list => list.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  const copyMonday = () => setPeriods(list => [...list.filter(p => p.weekday === 0 || p.weekday === 1 || p.weekday === 6),
    ...[2, 3, 4, 5].flatMap(d => list.filter(p => p.weekday === 1).map(p => ({ ...p, weekday: d })))]);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0"><CardTitle className="text-base">Intervalos de trabalho</CardTitle>
          {isAdmin && <div className="flex gap-2"><Button size="sm" variant="outline" onClick={copyMonday}>Copiar segunda para ter–sex</Button>
            <Button size="sm" disabled={saving} onClick={() => run(() => svc.replaceWorkPeriods(periods), 'Expediente salvo.')}>Salvar</Button></div>}
        </CardHeader>
        <CardContent className="space-y-3">
          {WEEKDAYS.map((label, weekday) => (
            <div key={label} className="space-y-1">
              <div className="flex items-center justify-between text-sm font-medium">{label}
                {isAdmin && <Button variant="ghost" size="sm" onClick={() => setPeriods(l => [...l, { weekday, startsAt: '07:45', endsAt: '12:00' }])}><Plus className="h-3 w-3" /></Button>}</div>
              {periods.map((p, i) => p.weekday === weekday && (
                <div key={i} className="flex items-center gap-2">
                  <Input type="time" className="w-32" disabled={!isAdmin} value={p.startsAt} onChange={e => update(i, { startsAt: e.target.value })} />
                  <span className="text-muted-foreground">até</span>
                  <Input type="time" className="w-32" disabled={!isAdmin} value={p.endsAt} onChange={e => update(i, { endsAt: e.target.value })} />
                  {isAdmin && <Button variant="ghost" size="icon" aria-label="Remover intervalo" onClick={() => setPeriods(l => l.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>}
                </div>
              ))}
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Feriados</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {isAdmin && <div className="flex gap-2">
            <Input type="date" className="w-40" value={holiday.day} onChange={e => setHoliday(h => ({ ...h, day: e.target.value }))} />
            <Input placeholder="Nome" value={holiday.name} onChange={e => setHoliday(h => ({ ...h, name: e.target.value }))} />
            <Button size="sm" onClick={() => run(() => svc.saveHoliday(holiday).then(() => setHoliday({ day: '', name: '' })), 'Feriado salvo.')}>Adicionar</Button>
          </div>}
          {data.holidays.length === 0 && <p className="text-sm text-muted-foreground">Nenhum feriado.</p>}
          {data.holidays.map(h => (
            <div key={h.day} className="flex items-center justify-between text-sm">
              <span>{h.day.split('-').reverse().join('/')} · {h.name}</span>
              {isAdmin && <Button variant="ghost" size="icon" aria-label="Excluir feriado" onClick={() => run(() => svc.deleteHoliday(h.day), 'Feriado excluído.')}><Trash2 className="h-4 w-4" /></Button>}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function LossReasons({ data, isAdmin, run }: { data: EngineeringSnapshot; isAdmin: boolean; run: RunFn }) {
  const [draft, setDraft] = React.useState('');
  return (
    <Card>
      <CardContent className="space-y-2 pt-6">
        {isAdmin && <div className="flex gap-2">
          <Input placeholder="Novo motivo de perda" value={draft} onChange={e => setDraft(e.target.value)} />
          <Button size="sm" onClick={() => run(() => svc.saveLossReason(null, { name: draft, active: true }).then(() => setDraft('')), 'Motivo salvo.')}>Adicionar</Button>
        </div>}
        {data.lossReasons.length === 0 && <p className="text-sm text-muted-foreground">Nenhum motivo cadastrado.</p>}
        {data.lossReasons.map(r => (
          <div key={r.id} className="flex items-center justify-between text-sm">
            <span className={r.active ? '' : 'text-muted-foreground line-through'}>{r.name}</span>
            {isAdmin && <Switch checked={r.active} aria-label="Ativo" onCheckedChange={v => run(() => svc.saveLossReason(r.id, { name: r.name, active: v }))} />}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
