# Preparação da leitura de vendas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking. Executar na própria sessão; este plano não solicita delegação.

**Goal:** Criar uma fronteira de persistência para as leituras de vendas, preservando o comportamento atual e preparando um adaptador PostgreSQL.

**Architecture:** As funções públicas em `src/server/operations/sales.ts` mantêm autorização e validação. Um repositório interno concentra consulta e cálculo, inicialmente com implementação Firestore. A interface inclui resumo agregado, permitindo que um futuro adaptador SQL devolva totais sem transferir pedidos completos.

**Tech Stack:** Next.js 15, Node.js 22, TypeScript, Zod, Firebase Admin, Vitest e emulador Firestore já utilizados pelo projeto. Sem novas dependências nesta etapa.

**Spec:** `docs/superpowers/specs/2026-09-12-operational-postgres-design.md` — ler a especificação e este plano antes de executar.

## Global Constraints

- Manter o login do sistema, o OAuth do MCP e a aplicação na Vercel.
- O MCP continua usando as permissões efetivas do usuário, verificadas pelo servidor a cada operação.
- A mudança de banco não concede permissões nem habilita escrita pelo Claude.
- O Firestore permanece como fonte principal até que todas as entradas de escrita do núcleo tenham sido adaptadas e verificadas.
- Não representar falha como resultado vazio nem consultar o Bling silenciosamente no MCP.
- Esta entrega altera somente a organização interna da leitura de vendas. Não cria schema hospedado, importa dados reais, publica, muda plano ou troca a fonte em produção.
- Preservar alterações locais preexistentes; usar checkout isolado com prefixo `codex/` na execução quando necessário.

---

**Execução:** concluída localmente em 12/09/2026; [evidência](../../evidence/operational-postgres-phase1.md). Todos os testes passaram; TypeScript mantém 25 diagnósticos preexistentes idênticos.

## Mapa dos arquivos

| Arquivo | Responsabilidade |
| --- | --- |
| Criar `src/server/persistence/sales-contract.ts` | Tipos dos pedidos de leitura e do resumo |
| Criar `src/server/persistence/firestore-sales.ts` | Implementação Firestore, cursores e resumo atual |
| Criar `src/server/persistence/sales.ts` | Exportar a implementação ativa, ainda fixa no Firestore |
| Modificar `src/server/operations/sales.ts` | Preservar API pública, autorização e parsing; delegar persistência |
| Criar `tests/operations/sales-boundary.test.ts` | Bloqueio antes da consulta e compatibilidade da API |
| Criar `tests/operations/sales-repository.test.ts` | Contrato do repositório e casos de paginação |
| Ler `tests/operations/sales.test.ts` e `tests/operations/fixtures.ts` | Regras e fixtures existentes |
| Ler `tests/mcp/read-tools.test.ts` e `src/server/operations/production-demand.ts` | Consumidores que devem permanecer compatíveis |

## Task 1: Registrar o comportamento público antes da extração

**Interfaces:** consome as funções existentes `summarizeSales(context, raw)`, `listSales(context, raw, webFinance?)`, `getSale(context, id)` e `readOrdersForPeriod({ from, to })`. Produz testes de caracterização do contrato existente; eles devem passar antes e depois da extração.

- [x] Registrar `git status --short` e a revisão de origem. Confirmar que nenhum comando de teste carrega `.env.local`, `service-account.json` ou credenciais hospedadas. `tests/setup.ts` já direciona Firebase ao emulador `127.0.0.1:8188`, projeto `demo-brsteel-auth`.
- [x] Criar `tests/operations/sales-boundary.test.ts` com os casos abaixo:

```ts
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { adminDb } from '../helpers/firestore';
import { context, seedOperations } from './fixtures';
import { getSale, listSales, summarizeSales } from '@/server/operations/sales';

beforeEach(seedOperations);
afterEach(() => vi.restoreAllMocks());

it('nega leitura comercial antes de consultar persistência', async () => {
  const collections = vi.spyOn(adminDb, 'collection');
  await expect(getSale(context('Operador'), '1')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(summarizeSales(context('Operador'), { from: '2026-09-01', to: '2026-09-02' }))
    .rejects.toMatchObject({ code: 'FORBIDDEN' });
  expect(collections).not.toHaveBeenCalled();
});

it('mantém zero sem base, avisos e origem para o MCP', async () => {
  const ctx = context();
  const response = await summarizeSales({ ...ctx, actor: { ...ctx.actor, source: 'mcp' } },
    { from: '2020-01-01', to: '2020-01-31' });
  expect(response.source).toBe('firestore');
  expect(response.data.totalRevenue).toBe(0);
  expect(response.data.stats.totalRevenue.change).toBeNull();
  expect(response.warnings).toEqual(expect.arrayContaining([
    expect.stringContaining('Nenhum pedido encontrado no banco'),
  ]));
  expect(response.nextCursor).toBeNull();
});

it('mantém os códigos de registro ausente e cursor inválido', async () => {
  await expect(getSale(context(), 'inexistente')).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
  await expect(listSales(context(), { cursor: 'cursor-invalido' }))
    .rejects.toMatchObject({ code: 'INVALID_CURSOR' });
});
```

- [x] Executar os testes de caracterização com o emulador. Usar o Firebase CLI disponível, conferindo `firebase --help` e `firebase emulators:exec --help` antes da primeira execução. Não instalar versão nova implicitamente.

```sh
firebase emulators:exec --only firestore --project demo-brsteel-auth --config firebase.test.json 'npx --no-install vitest run tests/operations/sales.test.ts tests/operations/sales-boundary.test.ts'
```

Esperado: os casos passam no código atual. Uma falha deve ser investigada como diferença de entendimento antes de extrair funções.

## Task 2: Extrair o contrato e a implementação Firestore

**Interfaces:** consome `SaleOrder` de `src/types/sale-order.ts` e `OperationResult` de `src/types/operations.ts`; produz `SalesReadRepository` e `salesReadRepository`. As entradas chegam validadas pelas operações. A interface é interna e não pode ser importada por componentes cliente.

- [x] Criar `tests/operations/sales-repository.test.ts` antes do módulo novo:

```ts
import { beforeEach, expect, it } from 'vitest';
import { adminDb } from '../helpers/firestore';
import { seedOperations } from './fixtures';
import { salesReadRepository } from '@/server/persistence/sales';

beforeEach(seedOperations);
it('devolve resumo e período anterior pelo contrato interno', async () => {
  const response = await salesReadRepository.summarize(
    { from: '2026-09-01', to: '2026-09-02' }, { databaseOnly: true });
  expect(response.data).toMatchObject({ totalRevenue: 300, totalSales: 2, averageTicket: 150,
    uniqueCustomers: 2, previousPeriod: { from: '2026-08-30', to: '2026-08-31' } });
  expect(response.data.stats.totalRevenue.change).toBe(100);
});
it('mantém ordenação por data e ID entre páginas com datas iguais', async () => {
  const original = (await adminDb.collection('salesOrders').doc('2').get()).data()!;
  await adminDb.collection('salesOrders').doc('4').set({ ...original, id: 4 });
  const a = await salesReadRepository.list({ limit: 1, from: '2026-09-01', to: '2026-09-02' });
  const b = await salesReadRepository.list({ limit: 1, from: '2026-09-01', to: '2026-09-02', cursor: a.nextCursor! });
  expect(a.data.map(order => order.id)).toEqual([4]);
  expect(b.data.map(order => order.id)).toEqual([2]);
});
```

- [x] Rodar o comando de emulador da tarefa 1, selecionando `tests/operations/sales-repository.test.ts`. Esperado: falha pela ausência do módulo `@/server/persistence/sales`.
- [x] Criar `sales-contract.ts` com o contrato:

```ts
import type { SaleOrder } from '@/types/sale-order';
import type { OperationResult } from '@/types/operations';
export type SalesRange = { from: string; to: string };
export type SalesListInput = {
  limit: number; cursor?: string; from?: string; to?: string; storeId?: number; statusId?: number;
};
export type SalesMetric = 'totalRevenue' | 'totalSales' | 'averageTicket' | 'uniqueCustomers';
export type SalesSummary = Record<SalesMetric, number> & {
  previousPeriod: SalesRange;
  topProducts: { name: string; total: number; revenue: number }[];
  salesByState: { state: string; revenue: number }[];
  stats: Record<SalesMetric, { value: number; change: number | null }>;
};
export interface SalesReadRepository {
  list(input: SalesListInput): Promise<OperationResult<SaleOrder[]>>;
  get(id: string): Promise<OperationResult<SaleOrder>>;
  summarize(input: SalesRange, options: { databaseOnly: boolean }): Promise<OperationResult<SalesSummary>>;
  readOrdersForPeriod(input: SalesRange): Promise<SaleOrder[]>;
}
```

- [x] Criar `firestore-sales.ts` com `import 'server-only'`. Mover de `operations/sales.ts` os corpos existentes de `ordersQuery`, `readOrdersForPeriod`, consulta de `listSales`, consulta de `getSale`, `finite`, `totals` e cálculo de `summarizeSales`. Usar os mesmos filtros, `FieldPath.documentId()`, cursores, mensagens, ordenação, tratamento de não finitos e envelope `result`. A única substituição no cálculo é `context.actor.source === 'mcp'` por `options.databaseOnly`. Não alterar exclusões, ranking, arredondamento ou formato de resposta durante a extração.
- [x] Exportar do módulo o objeto abaixo, ligando as funções locais extraídas aos métodos do contrato:

```ts
export const firestoreSalesReadRepository: SalesReadRepository = {
  list, get, summarize, readOrdersForPeriod,
};
```

Aqui `list`, `get`, `summarize` e `readOrdersForPeriod` são os nomes das funções locais extraídas no passo anterior, com as assinaturas do contrato. `ordersQuery`, `finite` e `totals` permanecem privados no mesmo arquivo. Nenhuma dependência desse módulo aponta para `operations/sales.ts`.

- [x] Criar `src/server/persistence/sales.ts`:

```ts
import 'server-only';
export { firestoreSalesReadRepository as salesReadRepository } from './firestore-sales';
```

- [x] Transformar as quatro funções públicas em `operations/sales.ts` em wrappers. Preservar o `listInput` atual e os imports de schemas e autorização. Remover apenas os imports de persistência que ficaram sem uso. Os corpos serão:

```ts
export async function listSales(context: AccessContext, raw: unknown, webFinance = false) {
  if (webFinance) requireWebPage(context, '/financeiro/conciliacao');
  else requireOperation(context, 'vendas:read');
  return salesReadRepository.list(listInput.parse(raw));
}
export async function getSale(context: AccessContext, id: string) {
  requireOperation(context, 'vendas:read');
  return salesReadRepository.get(documentIdSchema.parse(id));
}
export async function summarizeSales(context: AccessContext, raw: unknown) {
  requireOperation(context, 'vendas:read');
  return salesReadRepository.summarize(dateRangeSchema.parse(raw), {
    databaseOnly: context.actor.source === 'mcp',
  });
}
/** Leitura interna; o consumidor deve autorizar a projeção comercial ou operacional. */
export async function readOrdersForPeriod(input: { from: string; to: string }): Promise<SaleOrder[]> {
  return salesReadRepository.readOrdersForPeriod(dateRangeSchema.parse(input));
}
```

Adicionar o import de `salesReadRepository` do módulo criado. A demanda de produção mantém seu próprio `requireOperation`; não deve ser obrigada a adquirir a capacidade comercial de vendas.

- [x] Rodar os três arquivos de teste de vendas no emulador. Esperado: todos passam. Conferir o diff: nenhuma nova variável de ambiente, chamada Supabase ou mudança nos arquivos OAuth.

## Task 3: Verificar os consumidores e encerrar a primeira entrega

**Interfaces:** consome o contrato público preservado na tarefa 2. Produz evidência de regressão e uma alteração local revisável; não executa corte de banco.

- [x] Executar a suíte dos módulos afetados no emulador, incluindo acesso, MCP e operações:

```sh
firebase emulators:exec --only firestore --project demo-brsteel-auth --config firebase.test.json 'npx --no-install vitest run tests/operations tests/mcp tests/access'
```

- [x] Executar `npm run typecheck`; comparar com a linha de base da revisão de origem. Registrar qualquer erro preexistente separadamente e corrigir os introduzidos nesta entrega. Executar `npm run build` com configuração local apropriada, sem publicar ou modificar variáveis remotas.
- [x] Conferir com `rg -n 'firebase-admin|adminDb|collection\(' src/server/operations/sales.ts` que a consulta Firestore foi removida desse arquivo. Conferir que apenas módulos de servidor importam o novo repositório.
- [x] Registrar os comandos, resultados e revisão em `docs/evidence/operational-postgres-phase1.md`, com o estado real dos testes. Não afirmar que PostgreSQL está ativo ou que o custo já caiu: esta etapa apenas prepara o caminho.
- [x] Revisar o diff e agrupar somente os arquivos desta entrega. Commit, push e publicação seguirão a autorização vigente da execução; não incluir os documentos MCP que já estavam alterados no workspace.

**Próxima entrega:** esquema SQL e importação do núcleo em ambiente isolado, com os contratos de leitura já estabilizados. Antes de executar essa entrega, detalhar seu próprio plano com as dependências e os critérios definidos na especificação; esta primeira entrega não autoriza execução automática das demais etapas.
