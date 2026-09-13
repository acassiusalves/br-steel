# Troca da fonte oficial para PostgreSQL — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking. Esta entrega **altera produção**: cada tarefa exige autorização explícita do usuário no momento da execução. Não encadear tarefas automaticamente.

**Goal:** Trocar a fonte oficial de leitura e gravação do núcleo do Firestore para o PostgreSQL, com janela de manutenção, divergência zero conferida no corte e recuperação demonstrada.

**Architecture:** O corte é um procedimento, não uma variável de ambiente. As mutações do núcleo são bloqueadas por um interruptor de manutenção verificado na fronteira de operações; as chamadas já iniciadas drenam; a fila de webhooks acumula sem perder entregas; a reconciliação final roda com os escritores parados; os dados são comparados; só então o seletor muda e a fila é retomada. O ensaio completo acontece primeiro em homologação, com dados reais copiados, antes de qualquer alteração em produção.

**Tech Stack:** Next.js 15, Node.js 22, TypeScript, `pg` 8.23.0, PostgreSQL 17 no Supabase `mlumbvxpaqfzpdjnvzxc`, Firebase Admin, Vercel CLI.

**Spec:** `docs/superpowers/specs/2026-09-12-operational-postgres-design.md`, etapa 5.

## Global Constraints

- Pré-requisito absoluto: etapa 4 concluída e verificada, com as 19 entradas de escrita portadas e equivalentes. **Não iniciar esta etapa com qualquer escritor pendente.**
- Manter o login do sistema, o OAuth do MCP e a aplicação na Vercel.
- A mudança de banco não concede permissões nem habilita escrita pelo Claude. `MCP_WRITES_ENABLED=false` permanece.
- Destino exclusivo `mlumbvxpaqfzpdjnvzxc`; origem exclusiva `marketflow-9h4tg`.
- Uma cópia ainda desatualizada não deve servir como fonte oficial de saldo ou produção.
- Uma varredura paginada não é um snapshot transacional: a reconciliação final só vale com os escritores efetivamente parados.
- Em erro de banco, retornar indisponibilidade; não representar falha como resultado vazio.
- A remoção de dados Firestore **não** faz parte deste corte. O Firestore permanece intacto e legível como base de retorno.
- Teto de planejamento: 400 MB por banco e 4 GB de tráfego não cacheado compartilhado por ciclo. Se a projeção medida exceder, ajustar consultas, cache e frequência, ou apresentar o custo de um plano pago. **Não trocar plano automaticamente.**
- Nenhum passo desta etapa apaga histórico, auditoria ou dados de negócio.

## Escritores a bloquear

Inventário fechado na etapa 4. O interruptor de manutenção precisa cobrir todos:

| Superfície | Caminho | Como é bloqueada |
| --- | --- | --- |
| Insumos | `src/server/operations/supplies.ts` (5 ops) | `requireCoreWritesEnabled()` na fronteira |
| Produção | `src/server/operations/production.ts` (12 ops) | `requireCoreWritesEnabled()` na fronteira |
| Webhook Bling | `src/app/api/webhook/bling/route.ts` | continua **recebendo e enfileirando**; o dreno é suspenso |
| Sincronização manual | `src/app/actions.ts` → `order-service.ts` | `requireCoreWritesEnabled()` antes de iniciar |
| MCP | `src/server/mcp/read-tools.ts` | já somente leitura; `MCP_WRITES_ENABLED=false` |
| Versões antigas do aplicativo | deployments Vercel anteriores ainda acessíveis | interruptor lido do banco, não de variável de build |

**O interruptor precisa ser lido em tempo de execução a partir de um registro compartilhado, não de uma variável de ambiente do build.** Um deployment antigo com a variável antiga continuaria gravando. Este é o ponto que a spec chama de "versões antigas do aplicativo".

## Pré-requisitos resolvidos antes desta etapa

A etapa 4 deixou dois pontos que este roteiro precisava absorver. Ambos foram resolvidos e verificados; o que está escrito abaixo é o estado real do código, não uma intenção.

### Colisão de identificadores entre linha nativa e documento de snapshot

Três coleções derivam o identificador do mesmo jeito nos dois lados: o contador anual (`production-lots-AAAA`), a chave de SKU (`sha256(sku)`) e as colunas padrão (`default-N`). Um documento de snapshot podia, portanto, cair exatamente sobre uma linha que a aplicação gravou.

**Decisão: recusar alto.** O importador detecta a colisão antes de qualquer mutação e aborta com `Native row collision: <coleção>/<id>`, deixando a linha nativa intacta. Deixar o snapshot vencer faria o contador de lotes andar para trás e cunhar números duplicados, e não existe regra de mesclagem obviamente certa para um contador. Resolver uma colisão é ato deliberado, não decisão de uma importação.

O teste semeia um contador nativo em 42, importa um snapshot que traz o mesmo identificador com sequência 3, e exige que a importação recuse e que o 42 permaneça.

**Consequência para o corte:** o comparador desta etapa distingue origem por `import_run_id = NATIVE_RUN_ID`. Uma linha nativa não tem contraparte no Firestore e **não é divergência**. Sem isso, o critério de divergência zero seria inalcançável depois da primeira gravação nativa.

### Agendamento do dreno sob o interruptor

O modo do núcleo vive em `appConfig/coreWriteMode`, lido em tempo de execução por `readCoreWriteMode()` em `src/server/operations/maintenance.ts` — **nunca de variável de build**, porque um deployment antigo ainda alcançável carregaria o valor velho. Ausente ou irreconhecível significa `open`: manutenção se liga de propósito.

`drainWebhookEvents` consulta o modo e devolve `suspended: true` sem aplicar nada enquanto estiver `blocked`; os eventos acumulam e são retomados depois. O cron `/api/cron/bling-webhook-drain` roda a cada cinco minutos, **falha fechado** (sem `CRON_SECRET` responde 503, ao contrário dos crons mais antigos, porque este aplica gravações de negócio) e reusa `processDelivery`, o mesmo caminho do POST — um dreno que reimplementasse o processamento divergiria dele.

Há teste fim a fim: uma entrega que o Bling não devolve fica em `failed`, o dreno a retoma quando a API responde, e o pedido é gravado. E outro que prova a suspensão: com o modo `blocked` nada é aplicado, e ao voltar para `open` o evento é processado.

**O que a Task 1 ainda precisa fazer:** acrescentar `requireCoreWritesEnabled()` no mesmo arquivo e ligá-lo às 17 operações de escrita. O documento, os valores e o caminho de leitura já são os que este plano especifica, então é extensão, não substituição.

---

## Task 1: Interruptor de manutenção

**Files:**
- Create: `src/server/operations/maintenance.ts`, `tests/operations/maintenance.test.ts`
- Modify: `src/server/operations/supplies.ts`, `src/server/operations/production.ts`, `src/app/actions.ts`, `src/server/ingest/webhook-queue.ts`

**Interfaces:**

```ts
export type CoreWriteMode = 'open' | 'draining' | 'blocked';
export function readCoreWriteMode(): Promise<CoreWriteMode>;   // sem cache acima de 5 segundos
export function requireCoreWritesEnabled(): Promise<void>;      // lança MAINTENANCE 503
```

- [x] **Passo 1 — Teste vermelho.** Em `tests/operations/maintenance.test.ts`: com modo `blocked`, cada uma das 17 operações de escrita de insumos e produção recusa com `MAINTENANCE` 503 **antes** de tocar a persistência; a sincronização manual recusa ao iniciar; o webhook continua respondendo 200 e enfileirando; as leituras continuam funcionando normalmente. Rodar e confirmar falha.
- [x] **Passo 2 — Implementar.** O modo vive num registro compartilhado lido em runtime, com cache de no máximo 5 segundos. `draining` recusa novas mutações mas não interrompe as já iniciadas. A mensagem ao usuário explica manutenção em andamento, não erro.
- [x] **Passo 3 — Ligar nas fronteiras.** Inserir `await requireCoreWritesEnabled()` no início de cada operação de escrita, depois da autorização e antes da validação. Em `webhook-queue.ts`, o dreno verifica o modo e não processa enquanto `blocked`.
- [x] **Passo 4 — Verificar e commitar.** Suíte completa, typecheck, build. Commit `feat(ops): add core write maintenance switch`.

---

## Task 2: Reconciliação final e comparador de corte

**Files:**
- Create: `scripts/operational-cutover.ts`, `src/server/migration/operational-reconcile.ts`
- Test: `tests/postgres/operational-cutover.integration.ts`

**Interfaces:**

```ts
// CLI: reconcile | compare | report — todos exigem modo 'blocked' confirmado no início e no fim
export function reconcileFromFirestore(opts: { since: string }): Promise<{ applied: number; deleted: number }>;
export function compareSources(): Promise<{ divergences: Divergence[]; counts: Record<string, [number, number]> }>;
```

- [x] **Passo 1 — Teste vermelho do comparador.** Em ambiente descartável, semear divergências deliberadas: documento presente só no Firestore; só no PostgreSQL; conteúdo diferente; exclusão lógica em um lado; contador de lotes defasado; ordem de itens alterada. O comparador precisa apontar cada uma com coleção e ID. **Um comparador que devolve zero divergências num cenário semeado é uma falha da tarefa, não um sucesso.**
- [x] **Passo 2 — Implementar a reconciliação.** Reaproveitar `exportOperationalSnapshot` e `importSnapshot` das etapas 2–3. A reconciliação aplica criações, atualizações e exclusões posteriores à carga anterior, de forma idempotente e versionada. Rejeitar execução se o modo não estiver `blocked`.
- [x] **Passo 3 — Implementar o comparador.** Comparar conteúdo normalizado, referências, contagens e agregados por período, mantendo a distinção entre campo ausente, nulo e zero. Cobrir as 13 tabelas e as dez coleções.
- [x] **Passo 4 — Verificar e commitar.** `npm run test:postgres`, typecheck. Commit `feat(postgres): add cutover reconciliation and comparator`.

### Resultado das Tasks 1 e 2

Executadas e verificadas em 13/09/2026. Vitest **274 testes em 46 arquivos**; integração PostgreSQL **42**; typecheck nos 25 preexistentes; build compilou.

**Task 1 — interruptor.** `requireCoreWritesEnabled()` recusa com `MAINTENANCE` 503 em `draining` e `blocked`, depois da autorização e antes da validação: um chamador sem permissão continua sabendo que não tem permissão, em vez de descobrir uma janela de manutenção que não lhe diz respeito. O modo é cacheado por no máximo 5 s — uma janela é aberta e fechada por uma pessoa, então segundos de defasagem são aceitáveis; uma leitura por mutação não é.

As 17 operações estão cobertas por dois pontos (`guard` em insumos, `write` em produção), mais as duas entradas de sincronização em `actions.ts` — `fullSyncOrders` e `getBlingOrderDetails`, que lê do Bling mas persiste, então é escritora para efeito do corte. O teste enumera as 17 e falha se alguém acrescentar uma sem cobrir; e prova que **nenhuma coleção operacional é tocada** durante a recusa, nem a consulta de identidade que precede uma escrita de produção.

**Task 2 — comparador e reconciliação.** `compareSources` compara a cópia contra uma **exportação nova**, não contra a escrituração do próprio importador: os digests que ele gravou não são evidência de que os payloads ainda concordam. Linhas nativas são contadas e nunca reportadas — sem isso, divergência zero seria inalcançável depois da primeira gravação nativa, exatamente o ponto resolvido nos pré-requisitos.

`reconcileFromFirestore` recusa a menos que o núcleo esteja `blocked`, e o teste prova a recusa em `open` e em `draining` **e** que a recusa não altera nada. O comparador foi validado por mutação: parar de reportar linhas que sumiram da origem quebra o teste das divergências semeadas.

A CLI `npm run cutover -- <reconcile|compare|report>` imprime apenas contagens, divergências e o modo. Nunca payloads ou credenciais: o relatório circula, o conteúdo não.

**Uma pendência conhecida:** numa de oito execuções da suíte completa houve uma falha que não consegui caracterizar. As sete restantes e o CI passaram. Se reaparecer, o suspeito é a concorrência do emulador Firestore.

---

## Task 2.5: Seletor trocável em runtime

**Falha deste plano, corrigida.** As Tasks 3 e 4 mandavam "trocar o seletor", mas **nenhuma tarefa construía essa capacidade**: os oito seletores eram `export` fixos resolvidos no carregamento do módulo. Não era possível ensaiar a troca de algo que não era trocável. Esta tarefa foi acrescentada e executada em 13/09/2026.

- [x] `appConfig/operationalSource` guarda `firestore` ou `postgres`, lido em runtime com cache de no máximo 5 s. Ausente ou irreconhecível significa `firestore`: a fonte muda de propósito, nunca por acidente nem por erro de digitação na configuração.
- [x] `selectRepository` resolve a implementação **por chamada**, não no carregamento. Um repositório ligado no import congelaria a fonte pela vida da instância, e o corte precisa valer sem redeploy. Todo método de todo contrato é assíncrono, que é o que torna isso viável.
- [x] Selecionar PostgreSQL sem conexão configurada é **indisponibilidade 503, nunca recuo silencioso** para o Firestore: durante um corte, recuar mandaria leituras — e depois gravações — para a fonte que todos acreditam aposentada.
- [x] `operationalPoolConfig` recusa superusuário, ausência de senha, parâmetros extras na URL e TLS não verificado fora de loopback. O nome do login não é fixado, porque é escolha de quem provisiona; `postgres` é recusado explicitamente.
- [x] Teste prova que a mesma ligação de módulo passa a responder pelo outro banco sem reimportar nada, comparando valores deliberadamente diferentes nos dois lados (999 no Firestore, 700 no PostgreSQL).

Um defeito encontrado no caminho: o proxy cacheava o repositório construído e não acompanhava o descarte do pool, então continuava respondendo por uma conexão encerrada. Resolvido com contador de geração — importa em produção, não só no teste.

**O seletor nasce em `firestore` e assim permanece.** Esta tarefa constrói a capacidade de trocar; trocar é a Task 4.

---

## Task 3: Ensaio completo em homologação

**Requer autorização explícita do usuário.** Nenhum passo toca produção.

**Bloqueado por provisionamento, não por código.** A capacidade de troca existe desde a Task 2.5. Falta o que só o controlador pode fazer:

1. **Um login de escrita no Supabase hospedado.** A migration cria `brsteel_ops_writer` como `NOLOGIN`, por desenho; um login temporário precisa ser provisionado e associado a esse papel.
2. **Uma cópia recente dos dados reais** no destino — a do piloto da etapa 3 foi encerrada junto com os acessos temporários.
3. **As variáveis no projeto de homologação:** `BRSTEEL_OPERATIONAL_DATABASE_URL` e `BRSTEEL_OPERATIONAL_CA`.

- [ ] **Passo 1 — Preparar.** Publicar o candidato em `br-steel-mcp-staging.vercel.app` (projeto `prj_YD3ATzBPFQo4bD1ZlojrDTigUZp8`), com cópia recente dos dados reais e credencial de runtime restrita a `brsteel_ops_writer`. Registrar o deployment de rollback.
- [ ] **Passo 2 — Ensaiar o corte inteiro.** Executar, cronometrando cada fase: `draining` → esperar as chamadas em trânsito → `blocked` → confirmar dreno da fila suspenso → reconciliação final → comparação → exigir **divergência zero** → trocar o seletor → retomar a fila → `open`.
- [ ] **Passo 3 — Medir.** Registrar duração total da janela, bytes reais das chamadas completas e do backup, e a projeção de ciclo incluindo os demais projetos da organização. Comparar com os tetos de 400 MB por banco e 4 GB de tráfego. Se exceder, parar e apresentar as opções ao usuário antes de qualquer passo em produção.
- [ ] **Passo 4 — Ensaiar o retorno antes da primeira gravação oficial.** Voltar o seletor para Firestore depois de drenar as chamadas em trânsito. Confirmar que nada foi perdido.
- [ ] **Passo 5 — Ensaiar o retorno depois de gravações oficiais.** Gravar deliberadamente em PostgreSQL, depois executar o retorno completo: bloquear mutações, reconciliar as alterações de volta ao Firestore incluindo exclusões, conferir os efeitos já enviados a integrações e só então reativar. **Este passo é o que prova que o corte é reversível; sem ele a etapa não avança.**
- [ ] **Passo 6 — Evidência.** `docs/evidence/operational-postgres-cutover-rehearsal.{md,json}` com tempos, divergências encontradas e corrigidas, medições e limitações. Encerrar acessos temporários e restaurar homologação.

---

## Task 4: Corte em produção

**Requer autorização explícita do usuário, com janela combinada.** Executar somente após a Task 3 aprovada e as medições dentro dos tetos.

- [ ] **Passo 1 — Pré-voo.** Confirmar: backup recente restaurável (etapa 3), deployment de rollback anotado, fila de webhooks vazia ou drenada, nenhuma sincronização manual em curso, comparador em verde na última execução de homologação. Anotar o deployment atual de produção antes de qualquer mudança.
- [ ] **Passo 2 — Abrir a janela.** `draining` → aguardar o tempo medido na Task 3 → `blocked`. Confirmar pelo registro de auditoria que nenhuma mutação nova entrou.
- [ ] **Passo 3 — Reconciliar e comparar.** Executar a reconciliação final e o comparador. **Divergência zero é condição de avanço.** Qualquer divergência encerra a janela: reabrir em `open` com Firestore e investigar fora do corte.
- [ ] **Passo 4 — Ativar.** Trocar o seletor para PostgreSQL para leitores e escritores. Retomar o dreno da fila, que reaplica os eventos acumulados de forma idempotente. Voltar para `open`.
- [ ] **Passo 5 — Conferir a quente.** Verificar no navegador, com sessão legítima, as telas de vendas, estoque, Kanban, demanda e insumos. Executar uma gravação real de cada domínio e conferir o efeito na tela e no histórico. Verificar o MCP com `Meu acesso` e uma leitura de negócio, esperando `source: postgres`.
- [ ] **Passo 6 — Evidência.** `docs/evidence/operational-postgres-cutover.{md,json}`: horários reais da janela, resultado do comparador, deployments envolvidos, o que foi verificado e o que não foi. Não afirmar economia de custo: a medição pertence à etapa 6.

**Critério de saída da etapa 5:** escritores antigos bloqueados durante a janela, divergência zero conferida no corte e recuperação demonstrada nos dois sentidos.

**Próxima entrega:** `2026-09-12-operational-postgres-phase6-consolidation.md`.
