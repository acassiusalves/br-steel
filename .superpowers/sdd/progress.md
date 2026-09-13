# Histórico por SKU — progresso

Plano: docs/superpowers/plans/2026-09-13-historico-por-sku.md
Branch: claude/producao-page-analysis-2f8da0
Merge base: 4c5fb8aab3baab60e8e6bd137027f68b196d4031

Ordem de execução: 2, 1, 3, 4, 5, 6, 7, 8, 9, 10
(Task 2 primeiro: independente e única com custo por adiamento.)

Decisão pré-voo: Tasks 6, 9 e 10 sem teste automatizado — verificação no navegador.
Infra de teste é server-side only; adicionar jsdom ficou fora de escopo.

## Tarefas

Task 2: complete (commits df5b612..b0ca914, review clean — spec ✅, quality Approved)
  Minors para o review final triar:
   - sales-ingest-contract.ts sem `import 'server-only'` (pré-existente, 18 arquivos no repo)
   - teste "byte-for-byte compatible" usa toMatchObject (parcial) — herdado do brief
   - tolerância 700*86400000 redigitada no teste em vez de derivar da constante
  Pendente para humano: firebase deploy --only firestore:indexes --project marketflow-9h4tg
  Observação: postgres-sales-ingest.applyStockObservation também sobrescreve — dívida já registrada no spec.

AMBIENTE (vale para todos os dispatches): este worktree precisa de
  export JAVA_HOME=/opt/homebrew/opt/openjdk@21   (para firebase emulators:exec)
  npm install                                      (node_modules estava sem vitest)

Task 1: complete (commits b0ca914..c3121b3, review clean após 1 rodada de correção)
  Bug real encontrado na revisão: closedWeeksSince truncava lacunas > 106 semanas devolvendo as
  MAIS ANTIGAS e nunca alcançando a semana corrente. Corrigido com recorte na borda da janela +
  erro alto. Plano sincronizado com o código.
  Minor para o review final triar:
   - isoWeekRange valida semana 1..53 genericamente, não por ano: isoWeekRange('2025-W53') não
     lança, embora 2025 tenha 52 semanas. Só morde em corrupção externa; nenhum consumidor hoje.
