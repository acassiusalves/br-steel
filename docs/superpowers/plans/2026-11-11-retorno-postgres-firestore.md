# Retorno PostgreSQL → Firestore — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir a ferramenta que devolve o núcleo operacional do PostgreSQL para o Firestore. Ela torna o Firestore do ambiente igual ao PostgreSQL e devolve a fonte ao Firestore. É o Passo 5 da Task 3 em [`2026-09-12-operational-postgres-phase5-cutover.md`](2026-09-12-operational-postgres-phase5-cutover.md).

**Architecture:** Um espelho por diferença. Para cada coleção do retorno, compara o estado vivo do PostgreSQL (linhas nativas e importadas, `not source_deleted`) com os documentos do Firestore normalizados por `jsonValue`. Depois cria, atualiza (`set` sem merge) ou apaga só o que difere. Comandos primitivos (`plan`, `apply`, `verify`) não decidem nada. Uma sequência automática abre e fecha a janela (`draining` → `blocked` → `apply` → `verify` → troca da fonte → `open`) e restaura o núcleo num `finally`.

**Tech Stack:** TypeScript, `firebase-admin/firestore`, `pg`, `node:test` com emulador Firestore e PostgreSQL em contêiner (`npm run test:postgres`).

## Desenho aprovado (11/11/2026)

- **Abrangência:** as coleções de `COLLECTIONS`, menos `skuWeeklyDemand`. A demanda semanal se cura no retorno por recomputação: o rollup do Firestore recalcula a série a partir de `salesOrders`.
- **Por que espelho completo, e não o log de auditoria:** `brsteel_write.audit` não registra a ingestão por webhook (pedidos e saldos). Além disso, os adaptadores PostgreSQL apagam linhas de verdade (`delete from` em lotes, colunas, comentários, insumos e códigos). Só a comparação do estado inteiro enxerga tudo.
- **Domínio de cada coleção no Firestore:** todos os documentos da coleção, exceto em `operationsMetadata`, onde só entram os ids `^production-lots-\d{4}$`, como no export. Documentos fora do domínio nunca são tocados.
- **Classificação** por id: está no PostgreSQL e não no Firestore → `create`. Está nos dois com `contentHash(payload) !== contentHash(jsonValue(doc))` → `update`. Está no Firestore e não vivo no PostgreSQL → `delete`. Conteúdo igual → intocado.
- **Tipos na gravação:** `create` e `update` gravam o `payload` inteiro com `set` sem merge. Duas regras restauram Timestamps:
  1. `stockObservations.expiresAt`, quando for string ISO, vira `Timestamp`. A política de TTL ignora strings.
  2. Num `update`, todo campo de primeiro nível que hoje é `Timestamp` no documento do Firestore e chega como string ISO volta a ser `Timestamp`.

  A conversão é a inversa exata de `jsonValue`: a fração de 3 ou 9 dígitos é completada à direita até 9 dígitos de nanossegundos. String fora do formato `YYYY-MM-DDTHH:MM:SS(.f{1,9})?Z` continua string.
- **Travas do `apply`:** no Firestore de destino, `appConfig/operationalSource` precisa ser `postgres` e `appConfig/coreWriteMode` precisa ser `blocked`. A primeira garante que a ferramenta nunca grava no Firestore que é a fonte viva.
- **Repetição:** depois de um `apply` completo, `plan` devolve zero mudanças. Uma execução interrompida se resolve repetindo.
- **Sequência automática:**
  1. **Pré-voo sem gravar:** fonte `postgres`, `coreWriteMode` ausente, cópia `ready` e plano impresso.
  2. `draining`, espera 20 s.
  3. `blocked`, espera 10 s.
  4. `apply`.
  5. `verify`.
  6. **Com divergência zero:** apaga `operationalSource`, espera 10 s (o cache do seletor é de 5 s, e o núcleo continua bloqueado nesse intervalo) e reabre.
  7. **Com divergência ou erro:** não troca a fonte e reabre. O ambiente segue no PostgreSQL e nada se perde.

  A reabertura (apagar `coreWriteMode`) fica num `finally`.
- **Fora do escopo:** deixar a cópia pronta para um novo corte (as linhas nativas devolvidas colidiriam no próximo import) e desfazer efeitos já enviados a integrações.

## Global Constraints

- O repositório é público. Logs e relatórios imprimem só contagens, ids e tipos de mudança, nunca payloads, credenciais ou dados de cliente. Erros vindos do driver ou do SDK não são impressos crus.
- Os módulos em `src/server/migration/` recebem `db: Firestore` e `pool: Pool` por parâmetro. Não podem importar `@/lib/firebase-admin`, `@/server/persistence/source` nem `@/server/operations/maintenance`, porque esses módulos inicializam o app padrão do Firebase no import.
- O CLI inicializa um app **nomeado** com projeto explícito: `initializeApp({ projectId, credential: applicationDefault() }, 'operational-return')`.
- O destino é sempre explícito: `BRSTEEL_RETURN_TARGET_PROJECT` obrigatório, sem fallback.
- As gravações no Firestore são em lotes de no máximo 400 operações.
- Os testes de integração rodam pelo executor `npm run test:postgres`, com o emulador em `127.0.0.1:8188` e o projeto `demo-brsteel-auth`. Os arquivos rodam em sequência e compartilham emulador e banco, então cada teste parte de estado zerado (veja `resetBoth` em `tests/postgres/operational-cutover.integration.ts`).
- Mensagens ao operador em português, código e comentários em inglês, como no resto de `src/server/migration/`.
- Node.js 22. Rode `npm run lint`, `npm run typecheck:ci` (baseline de 25) e as suítes antes de concluir.

---

### Task 1: Núcleo do retorno (plan, apply, verify)

**Files:**
- Create: `src/server/operations/switch-values.ts`
- Modify: `src/server/persistence/source.ts` (usar `parseOperationalSource`)
- Modify: `src/server/operations/maintenance.ts` (usar `parseCoreWriteMode`)
- Modify: `src/server/migration/operational-export.ts` (exportar `jsonValue`)
- Create: `src/server/migration/operational-return.ts`
- Test: `tests/postgres/operational-return.integration.ts`
- Test: `tests/operations/switch-values.test.ts`

**Interfaces:**
- Produz, em `switch-values.ts` (sem dependências de Firebase ou pg):
  ```ts
  export type OperationalSource = 'firestore' | 'postgres';
  export type CoreWriteMode = 'open' | 'draining' | 'blocked';
  export function parseOperationalSource(stored: unknown): OperationalSource; // ausente/irreconhecível → 'firestore'
  export function parseCoreWriteMode(stored: unknown): CoreWriteMode;         // ausente/irreconhecível → 'open'
  ```
  `source.ts` e `maintenance.ts` passam a reexportar esses tipos e a usar as funções, sem mudar comportamento.
- Produz, em `operational-return.ts`:
  ```ts
  export const RETURN_COLLECTIONS: OperationalCollection[]; // COLLECTIONS sem 'skuWeeklyDemand'
  export type ReturnChange = { collection: OperationalCollection; id: string; kind: 'create' | 'update' | 'delete' };
  export type ReturnCounts = Record<string, { postgres: number; firestore: number; create: number; update: number; delete: number }>;
  export type ReturnPlan = { changes: ReturnChange[]; counts: ReturnCounts };
  export async function readSwitches(db: Firestore): Promise<{ source: OperationalSource; mode: CoreWriteMode }>;
  export async function planReturn(pool: Pool, db: Firestore): Promise<ReturnPlan>;
  export async function applyReturn(pool: Pool, db: Firestore): Promise<ReturnPlan>; // aplica e devolve o plano aplicado
  export async function verifyReturn(pool: Pool, db: Firestore): Promise<ReturnPlan>; // zero mudanças = aprovado
  export function timestampFromIso(value: string): Timestamp | null;
  ```
  `applyReturn` recusa com `Error` em português quando `source !== 'postgres'` ("O retorno só grava num Firestore cuja fonte ativa é postgres; a fonte é <x>.") ou quando `mode !== 'blocked'` ("O retorno exige o núcleo bloqueado; o modo é <x>."). Ele lê os dois registros do próprio `db`, sem cache.

- [ ] **Step 1: Testes vermelhos de `switch-values`.** Em `tests/operations/switch-values.test.ts` (Vitest), cubra `parseOperationalSource`: `undefined`, `'postgres'`, `'firestore'`, `'POSTGRES'`, `1` → `firestore`, `postgres`, `firestore`, `firestore`, `firestore`. Cubra `parseCoreWriteMode`: `undefined`, `'draining'`, `'blocked'`, `'x'` → `open`, `draining`, `blocked`, `open`. Rode `npx vitest run tests/operations/switch-values.test.ts` e confirme a falha (módulo inexistente).
- [ ] **Step 2: Implementar `switch-values.ts` e religar `source.ts` e `maintenance.ts`.** Rode a suíte de operações (`npx vitest run tests/operations`) e confirme verde.
- [ ] **Step 3: Testes vermelhos de integração.** Crie `tests/postgres/operational-return.integration.ts`. O preparo segue `operational-cutover.integration.ts`: zera o banco e o emulador, semeia o Firestore, faz `exportOperationalSnapshot` com `capturedAt` recuado 30 min e `importSnapshot` com `createLocalImportPool`, e semeia a execução nativa (`NATIVE_RUN_ID`). Depois simula, com SQL direto no pool local, o que a aplicação faria após o corte:
  - insere uma linha nativa em `supplies`, com `lookup_sku`, e outra em `stock_observation_log` com `payload.expiresAt` em ISO (`2028-11-11T12:00:00.000Z`) e id UUID;
  - altera o `payload` de um pedido importado (`total`) e atualiza o `source_hash`;
  - apaga de verdade (`delete from`) um lote importado e seus itens;
  - altera uma linha de `sku_weekly_demand`, que deve ser ignorada.

  O Firestore semeado inclui um documento de `stockUpdates` com um campo `Timestamp` não alterado, um documento `operationsMetadata/outro-contador` fora do domínio e um `stockUpdates` com campo `Timestamp` cujo `payload` vai mudar. Testes:
  1. `planReturn` lista exatamente as mudanças esperadas, por coleção e tipo, e nada de `skuWeeklyDemand` nem de `operationsMetadata/outro-contador`.
  2. `applyReturn` recusa com a fonte ausente (`firestore`) e com o modo diferente de `blocked`, sem gravar nada (`planReturn` continua igual depois).
  3. Com `operationalSource = postgres` e `coreWriteMode = blocked`, `applyReturn` deixa o Firestore igual:
     - o pedido tem o `total` novo;
     - o lote e seus itens sumiram;
     - o insumo nativo existe;
     - a observação nativa existe com `expiresAt instanceof Timestamp` e o instante exato;
     - o `stockUpdates` intocado mantém o seu `Timestamp`;
     - o `stockUpdates` alterado mantém o campo como `Timestamp`;
     - `operationsMetadata/outro-contador` e `skuWeeklyDemand` estão intocados.
  4. `verifyReturn` devolve zero mudanças. Um segundo `applyReturn` devolve plano vazio.
  5. `timestampFromIso`: `'2026-09-12T03:00:00.123Z'` → `{seconds, nanoseconds: 123000000}`, `'2026-09-12T03:00:00.123456789Z'` → 123456789 ns, `'2026-09-12T03:00:00Z'` → 0 ns, `'2026-09-12T03:00:00-03:00'` → `null`, `'x'` → `null`. Ida e volta: para o 2º caso, `jsonValue(timestampFromIso(s)) === s`.

  Rode `npm run test:postgres` e confirme a falha (módulo inexistente).
- [ ] **Step 4: Implementar `operational-return.ts`.** Leia o Firestore paginando por `FieldPath.documentId()` em páginas de 500, como `exportOperationalSnapshot`. Leia o PostgreSQL com `select source_id, payload from brsteel_ops.<tabela> where not source_deleted`. A comparação usa `contentHash` de `operational-snapshot.ts` e `jsonValue` de `operational-export.ts`. Se `jsonValue` ou `contentHash` falhar num documento, lance um erro que cite só coleção e id. Grave em `db.batch()` com até 400 operações por lote.
- [ ] **Step 5: Verde.** Rode `npm run test:postgres` (59 testes anteriores mais os novos, todos verdes), `npx vitest run tests/operations`, `npm run lint` e `npm run typecheck:ci`.
- [ ] **Step 6: Commit.** `feat(migration): add PostgreSQL to Firestore return plan, apply and verify`.

### Task 2: Sequência automática, CLI e roteiro

**Files:**
- Create: `src/server/migration/operational-return-run.ts`
- Create: `scripts/operational-return.ts` (comandos `plan`, `apply`, `verify`)
- Create: `scripts/operational-return-run.ts` (a volta inteira, exige `--confirm`)
- Modify: `package.json` (scripts `cutover:return-tool` e `cutover:return`)
- Modify: `supabase/operational/cutover-rehearsal.md` (seção do retorno)
- Test: `tests/postgres/operational-return.integration.ts` (acrescentar)

**Interfaces:**
- Consome, da Task 1: `planReturn`, `applyReturn`, `verifyReturn` e `readSwitches`.
- Produz:
  ```ts
  export type ReturnRunOutcome = { status: 'aborted' | 'returned' | 'divergent' | 'failed'; reason?: string; plan?: ReturnPlan; divergences?: ReturnChange[] };
  export async function runReturn(options: { pool: Pool; db: Firestore; wait: (seconds: number) => Promise<void>; log: (line: string) => void }): Promise<ReturnRunOutcome>;
  ```
  O pré-voo não grava nada. Ele exige `source === 'postgres'` (senão `aborted`), o documento `coreWriteMode` ausente (senão `aborted`) e `select ready from brsteel_import.state` igual a `true` (senão `aborted`), e imprime o plano. Depois:
  1. grava `{ mode: 'draining', updatedAt }` e espera `wait(20)`;
  2. grava `{ mode: 'blocked', updatedAt }` e espera `wait(10)`;
  3. roda `applyReturn` e depois `verifyReturn`;
  4. **com zero divergências:** apaga `appConfig/operationalSource`, espera `wait(10)` e devolve `returned`;
  5. **com divergência:** devolve `divergent` com a lista, sem trocar a fonte;
  6. **com exceção:** devolve `failed` com a mensagem, sem trocar a fonte.

  Num `finally`, apaga `appConfig/coreWriteMode`. Cada etapa sai em `log`, com contagens por coleção.

- [ ] **Step 1: Testes vermelhos de `runReturn`** no mesmo arquivo de integração, com `wait` que só registra os segundos e `log` que acumula as linhas.
  - **Sucesso:** a fonte vira ausente, `coreWriteMode` fica ausente, a sequência de esperas é `[20, 10, 10]` e o Firestore está igual ao PostgreSQL.
  - **Pré-voo com `coreWriteMode` presente:** devolve `aborted`, e nada é gravado (o documento continua com o valor semeado e a fonte continua `postgres`).
  - **Pré-voo com a fonte `firestore`:** devolve `aborted`.
  - **Falha no `apply`:** passe um `db` envolto num `Proxy` cujo `batch().commit()` lança erro, mas que deixa passar as leituras e as gravações de `appConfig`. Devolve `failed`, a fonte continua `postgres` e `coreWriteMode` está ausente.
  - **Divergência após o `apply`:** passe um `db` envolto num `Proxy` cujo `batch().set` descarta em silêncio a gravação de um documento específico. Devolve `divergent`, cita esse documento, a fonte continua `postgres` e `coreWriteMode` está ausente.
  - **Erro no plano do pré-voo** (por exemplo, `jsonValue` ou `contentHash` falhando num documento): devolve `aborted`, e nada é gravado.

  Rode `npm run test:postgres` e confirme a falha.
- [ ] **Step 2: Implementar `operational-return-run.ts`.** Verde em `npm run test:postgres`.
- [ ] **Step 3: CLI.** Use `scripts/operational-cutover.ts` e `scripts/operational-cutover-rehearsal.ts` como modelo de estrutura, mensagens e tratamento de erro.
  - `scripts/operational-return.ts <plan|apply|verify>` lê `BRSTEEL_CUTOVER_DATABASE_URL`, `BRSTEEL_CUTOVER_CA_FILE` (para destino hospedado) e `BRSTEEL_RETURN_TARGET_PROJECT`. Usa `createCutoverPool` de `scripts/lib/cutover-pool.ts`. Imprime o projeto de destino, a origem da cópia (`brsteel_import.state.source_project`) e, quando forem diferentes, a linha "destino diferente da origem da cópia: ensaio". Depois imprime as contagens por coleção e no máximo 50 mudanças (coleção/id/tipo). Termina com `exitCode = 1` em `verify` com divergência.
  - `scripts/operational-return-run.ts --confirm` faz o mesmo preparo. Também confere a identidade no PostgreSQL (`current_user = session_user` e não superusuário), como o ensaio do corte. Chama `runReturn` com `wait` real e `log` com carimbo ISO. Registra `SIGINT` e `SIGTERM` para apagar `coreWriteMode` antes de sair. Sem `--confirm`, recusa explicando que o comando bloqueia as escritas do núcleo no ambiente de destino.
  - Em `package.json`, `"cutover:return-tool": "node --conditions=react-server --import tsx scripts/operational-return.ts"` e `"cutover:return": "node --conditions=react-server --import tsx scripts/operational-return-run.ts"`.
- [ ] **Step 4: Roteiro.** Em `supabase/operational/cutover-rehearsal.md`, acrescente a seção "Retorno PostgreSQL → Firestore" depois de "Troca da fonte em homologação". Ela deve cobrir:
  - o que a ferramenta faz e o que deixa de fora (demanda semanal, cópia pronta para novo corte, integrações);
  - as variáveis e os comandos, com o login do importador;
  - as duas travas;
  - a sequência e o tempo da janela;
  - o que fazer com divergência;
  - as consequências para o ensaio na homologação: o primeiro retorno grava no Firebase da homologação uma cópia completa (cerca de 18,8 mil documentos), e uma cópia alterada pelo ensaio precisa ser recarregada do zero antes do corte da produção.

  Atualize também, no mesmo arquivo, a frase "Falta exercitar as telas do site e o retorno": a ferramenta existe, falta o ensaio.
- [ ] **Step 5: Verde completo.** `npm run lint`, `npm run typecheck:ci`, `npm run test:postgres` e `PATH="/opt/homebrew/opt/openjdk@21/bin:$PATH" npm run test:vitest`.
- [ ] **Step 6: Commit.** `feat(migration): add the automated return sequence and its CLI`.
