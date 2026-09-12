# Observação e consolidação do núcleo em PostgreSQL — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking. As tarefas 1 e 2 alteram produção e exigem autorização explícita do usuário.

**Goal:** Encerrar o período de observação com critérios atendidos, operacionalizar o backup diário externo e inventariar os consumidores Firestore restantes.

**Architecture:** O núcleo já lê e grava em PostgreSQL. Esta etapa transforma o que foi ensaiado em operação contínua: backup agendado com custódia externa e alerta de falha, limpeza por TTL das tabelas de auditoria e idempotência, métricas de consumo reais medidas ao longo de um período definido, e um inventário fechado do que ainda depende do Firestore. Nada aqui desativa o Firestore.

**Tech Stack:** Node.js 22, TypeScript, `pg` 8.23.0, PostgreSQL 17 no Supabase, `pg_dump` 17, age, Vercel Cron, Vercel CLI.

**Spec:** `docs/superpowers/specs/2026-09-12-operational-postgres-design.md`, etapa 6 e seção "Orçamento e recuperação".

## Global Constraints

- Pré-requisito: etapa 5 concluída, com o corte feito e a recuperação demonstrada nos dois sentidos.
- Objetivos de recuperação propostos: perda máxima de 24 horas e recuperação em até 2 horas. Precisam ser **aceitos pelo usuário para produção** e comprovados em ensaio; o ensaio de 12/09 mediu 3,42 s de restauração local e **não** comprova recuperação no serviço gerenciado, obtenção externa da chave nem retomada da aplicação.
- Retenção inicial proposta: sete cópias diárias e quatro semanais, reaproveitando a cópia diária para evitar download adicional do banco.
- Tetos de planejamento: 400 MB por banco e 4 GB de tráfego não cacheado compartilhado por ciclo, reservando 20% das quotas verificadas. São critérios desta migração, **não** limites do provedor.
- Bytes medidos localmente não equivalem à cobrança do provedor. Não apresentar economia mensal sem fatura.
- Arquivo de backup e chave em locais privados **separados**, fora do Git, modo 0600. A chave nunca entra em variável de ambiente de build nem em log.
- O Firestore permanece ativo. **Esta etapa não remove dados nem desativa o projeto.**
- Não trocar plano automaticamente. Se a projeção exceder o teto, apresentar o custo e as opções ao usuário.

---

## Task 1: Backup diário operacionalizado

**Files:**
- Create: `src/app/api/cron/operational-backup/route.ts`, `src/server/backup/schedule.ts`
- Modify: `vercel.json`, `scripts/lib/operational-backup.mjs`, `supabase/operational/README.md`
- Test: `tests/backup/schedule.test.ts`

**Interfaces:**

```ts
export type BackupRun = { id: string; startedAt: string; finishedAt: string | null;
  status: 'running' | 'succeeded' | 'failed'; bytes: number | null; error: string | null };
export function runScheduledBackup(): Promise<BackupRun>;
export function pruneBackups(policy: { daily: 7; weekly: 4 }): Promise<{ removed: string[] }>;
```

- [ ] **Passo 1 — Teste vermelho.** Em `tests/backup/schedule.test.ts`: uma execução concorrente não inicia um segundo backup; falha marca `failed` com causa e **não** apaga a cópia anterior; a retenção preserva exatamente 7 diárias e 4 semanais e remove só o excedente; a poda nunca remove a cópia mais recente bem-sucedida; erro de banco nunca vaza credencial ou payload na mensagem.
- [ ] **Passo 2 — Implementar o agendamento.** Reaproveitar `scripts/lib/operational-backup.mjs`, já validado no ensaio da etapa 3. O cron chama o mesmo caminho de código, sem duplicar a lógica de dump, criptografia e verificação.
- [ ] **Passo 3 — Registrar o cron.** Acrescentar ao `vercel.json` uma entrada diária, **preservando os três crons existentes** (`ml-health`, `ml-messages-drain`, `ml-messages-backfill`). A rota exige o segredo de cron já usado pelas demais.
- [ ] **Passo 4 — Custódia externa.** Definir com o usuário onde o arquivo criptografado e a chave ficam guardados, em locais separados e fora deste computador. Registrar o procedimento; **não** inventar um destino nem enviar o arquivo para um serviço sem autorização explícita.
- [ ] **Passo 5 — Alerta de falha.** Um backup que falha precisa ser visível: registrar o estado e apresentá-lo numa superfície que o usuário realmente consulte. Um `console.error` não é alerta.
- [ ] **Passo 6 — Ensaio de recuperação real.** Executar uma restauração completa a partir do arquivo agendado, obtendo a chave da custódia externa, e medir o tempo total até a aplicação voltar a atender. Comparar com o objetivo de 2 horas. **Enquanto este passo não passar, o objetivo de recuperação continua não comprovado** e deve ser descrito assim em qualquer documento.
- [ ] **Passo 7 — Verificar e commitar.** Suíte, typecheck, build. Commit `feat(backup): schedule daily encrypted operational backup`.

---

## Task 2: Limpeza por TTL e higiene das tabelas de escrita

**Files:**
- Create: `supabase/operational/migrations/*_operational_retention.sql`, `src/app/api/cron/operational-retention/route.ts`
- Test: `tests/postgres/operational-retention.integration.ts`

- [ ] **Passo 1 — Teste vermelho.** Provar que `brsteel_ops.write_audit` com mais de 90 dias e `brsteel_ops.write_idempotency` expirada ainda não são removidas; que a limpeza **nunca** remove auditoria dentro do prazo; e que a remoção de idempotência expirada não reabre a janela de uma operação ainda em curso.
- [ ] **Passo 2 — Implementar.** Limpeza em lotes limitados, para não segurar bloqueio longo em tabela de produção. Registrar quantas linhas foram removidas por execução.
- [ ] **Passo 3 — Registrar o cron** no `vercel.json`, preservando os existentes.
- [ ] **Passo 4 — Verificar e commitar.** `npm run test:postgres`, typecheck. Commit `feat(postgres): add retention cleanup for audit and idempotency`.

---

## Task 3: Período de observação

**Não é uma tarefa de código.** Requer um período de calendário combinado com o usuário. Sugestão: 14 dias corridos a partir do corte.

**Critérios de encerramento** — todos precisam ser atendidos; qualquer um falho estende o período ou reabre a etapa 5:

- [ ] **Disponibilidade.** Nenhuma indisponibilidade de banco não tratada. Toda falha retornou indisponibilidade explícita, nunca resultado vazio.
- [ ] **Integridade.** Comparador da etapa 5 executado ao menos uma vez por semana contra o Firestore preservado, com divergência zero nas coleções que ainda recebem escrita paralela — se houver alguma.
- [ ] **Concorrência.** Nenhum caso de saldo perdido, numeração de lote repetida ou movimento órfão no período.
- [ ] **Fila de webhooks.** Nenhum evento preso em `failed` sem retomada. Medir o tempo máximo entre recebimento e processamento.
- [ ] **Backup.** Ao menos 14 execuções diárias bem-sucedidas, retenção correta, e a recuperação real da Task 1 comprovada.
- [ ] **Orçamento.** Medir bytes reais das chamadas completas e do backup **incluindo os demais projetos da organização** e registrar a projeção de ciclo. Comparar com 400 MB por banco e 4 GB de tráfego. Se exceder, apresentar ao usuário as opções: ajustar consultas, cache e frequência, ou custo de um plano pago.
- [ ] **Latência.** Registrar duração das consultas de vendas, estoque, produção, demanda e insumos pela Vercel, comparando com os números do piloto da etapa 3 (`Resumo de vendas` 4.367 ms, `Estoque` 1.445 ms, `Demanda` 4.144 ms). Regressão relevante é motivo de investigação antes de encerrar.
- [ ] **Atualidade dos dados.** O piloto encontrou observações de saldo de meses anteriores. Confirmar que a cobertura e a data das observações são adequadas ao uso operacional. **Migrar de banco não torna uma observação antiga atual**; se a atualidade for insuficiente, isso é um problema de ingestão a resolver, não da migração.

---

## Task 4: Inventário dos consumidores Firestore restantes

**Files:**
- Create: `docs/evidence/operational-postgres-phase6.{md,json}`, `docs/firestore-consumidores-restantes.md`
- Modify: `docs/superpowers/specs/2026-09-12-operational-postgres-design.md`

- [ ] **Passo 1 — Levantar.** Buscar todas as referências restantes ao Firestore em `src/`, classificando cada uma: núcleo já migrado, módulo fora do recorte, identidade, ou integração. Os módulos conhecidos fora do primeiro recorte são Mercado Livre (anúncios, chat pós-venda, perguntas, contas), Bling (credenciais e callback), Magalu, financeiro/conciliação e `appConfig`.
- [ ] **Passo 2 — Classificar `users`.** A identidade continua no sistema atual por decisão de projeto. Registrar explicitamente que a janela de desativação concorrente aberta na etapa 4 permanece, e sob que condições ela seria fechada.
- [ ] **Passo 3 — Documentar.** `docs/firestore-consumidores-restantes.md` lista cada consumidor, o volume aproximado e o que seria necessário para migrá-lo. Este documento é a base de qualquer decisão futura sobre desativar o Firestore — que **não** pertence a esta etapa.
- [ ] **Passo 4 — Atualizar a spec.** Marcar as etapas 4, 5 e 6 com seu estado real e as limitações remanescentes. Não declarar concluído o que não foi comprovado.
- [ ] **Passo 5 — Evidência e encerramento.** Registrar os números reais do período de observação, as medições de orçamento e os critérios atendidos e não atendidos. Revisão independente e commit local.

**Critério de saída da etapa 6:** período de observação encerrado com todos os critérios da Task 3 atendidos e consumidores restantes inventariados.

**Fora do escopo desta migração:** liberação de ferramentas MCP de escrita, desativação do Firestore, remoção de dados e migração dos módulos Mercado Livre, Bling, Magalu e financeiro. Cada um exige sua própria entrega.
