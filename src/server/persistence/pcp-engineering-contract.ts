import type { OperationResult } from '@/types/operations';
import type { WriteActor } from './write-audit';

export type Extras = Record<string, unknown>;

export type ProductionPhase = { id: string; name: string; position: number };
export type ProductionLine = {
  id: string; name: string; monthlyCapacity: number; active: boolean; phases: ProductionPhase[];
};
export type ProductionOperation = {
  id: string; code: string; name: string; lineId: string; phaseId: string; position: number;
  predecessorId: string | null; location: 'interno' | 'externo'; classification: string | null;
  defaultWorkerId: string | null; active: boolean; extras: Extras;
};
export type WorkTeam = {
  id: string; name: string; status: 'aberto' | 'inativo' | 'fechado'; shift: 'manha' | 'tarde' | 'noite' | 'integral';
  leaderId: string | null; operationIds: string[]; members: TeamMemberRow[];
};
/** Organograma: `leaderId` é o superior do membro dentro desta equipe. */
export type TeamMemberRow = { workerId: string; leaderId: string | null };
export type Worker = {
  id: string; name: string; badge: string; kind: string; active: boolean; userId: string | null; operationIds: string[];
};
export type WorkPeriodRow = { weekday: number; startsAt: string; endsAt: string };
export type Holiday = { day: string; name: string };
export type LossReason = { id: string; name: string; active: boolean };

/** Todos os cadastros cabem numa leitura: dezenas de linhas, não milhares. */
export type EngineeringSnapshot = {
  lines: ProductionLine[]; operations: ProductionOperation[]; teams: WorkTeam[]; workers: Worker[];
  workPeriods: WorkPeriodRow[]; holidays: Holiday[]; lossReasons: LossReason[];
};

export type LineInput = { name: string; monthlyCapacity: number; active: boolean; phases: { id?: string; name: string }[] };
export type OperationInput = {
  code: string; name: string; phaseId: string; position: number; predecessorId: string | null;
  location: 'interno' | 'externo'; classification: string | null; defaultWorkerId: string | null; active: boolean;
};
export type TeamInput = {
  name: string; status: WorkTeam['status']; shift: WorkTeam['shift']; leaderId: string | null; operationIds: string[]; members: TeamMemberRow[];
};
export type WorkerInput = {
  name: string; badge: string; kind: string; active: boolean; userId: string | null; operationIds: string[];
};


export type SheetStatus = 'aberto' | 'aberto_avulso' | 'bloqueado' | 'suspenso' | 'versao_revisada' | 'fechado' | 'amostra';
export type ProductSheetSummary = {
  id: string; code: string; sku: string; name: string; status: SheetStatus; stepCount: number; componentCount: number;
};
export type ProductSheetStep = { operationId: string; predecessorOperationId: string | null; plannedMinutes: number | null; notes: string | null };
export type ProductSheetComponent = { componentSku: string; componentName: string | null; quantity: number; operationId: string | null };
export type ProductSheet = {
  id: string; code: string; sku: string; name: string; status: SheetStatus; baseQuantity: number; lineId: string | null;
  steps: ProductSheetStep[]; components: ProductSheetComponent[];
};
export type SheetInput = Omit<ProductSheet, 'id'>;

/**
 * Persistência dos cadastros de engenharia. Só existe em PostgreSQL. As operações autorizam e validam
 * a forma da entrada; o repositório aplica as regras que dependem do estado (predecessor, líder).
 */
export interface EngineeringRepository {
  read(): Promise<OperationResult<EngineeringSnapshot>>;
  /** `id` ausente cria. As fases são regravadas na ordem recebida; fases omitidas são removidas. */
  saveLine(id: string | null, input: LineInput, actor: WriteActor): Promise<OperationResult<{ id: string }>>;
  saveOperation(id: string | null, input: OperationInput, actor: WriteActor): Promise<OperationResult<{ id: string }>>;
  saveTeam(id: string | null, input: TeamInput, actor: WriteActor): Promise<OperationResult<{ id: string }>>;
  saveWorker(id: string | null, input: WorkerInput, actor: WriteActor): Promise<OperationResult<{ id: string }>>;
  /** Substitui o expediente inteiro. */
  replaceWorkPeriods(periods: WorkPeriodRow[], actor: WriteActor): Promise<OperationResult<null>>;
  saveHoliday(input: Holiday, actor: WriteActor): Promise<OperationResult<null>>;
  deleteHoliday(day: string, actor: WriteActor): Promise<OperationResult<null>>;
  saveLossReason(id: string | null, input: { name: string; active: boolean }, actor: WriteActor): Promise<OperationResult<{ id: string }>>;
  /** Fichas técnicas: a lista é curta (centenas) e vem inteira; o detalhe traz roteiro e componentes. */
  listSheets(): Promise<OperationResult<ProductSheetSummary[]>>;
  getSheet(id: string): Promise<OperationResult<ProductSheet>>;
  /** Regrava o roteiro e os componentes inteiros na ordem recebida. */
  saveSheet(id: string | null, input: SheetInput, actor: WriteActor): Promise<OperationResult<{ id: string }>>;
}
