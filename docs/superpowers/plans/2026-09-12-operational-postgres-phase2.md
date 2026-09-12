# Banco operacional e importação local — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar schema PostgreSQL, carga retomável de snapshots completos e leitura de vendas verificáveis localmente, mantendo a aplicação ativa em Firestore.

**Architecture:** Tabelas privadas com colunas de consulta e payload JSONB preservado. Um snapshot identifica a origem, a versão de cada documento e todas as coleções incluídas; checkpoints e mudanças de cada lote são atômicos. Adaptadores de leitura usam uma transação consistente e rejeitam cargas incompletas. Nenhum seletor de produção é alterado.

**Tech Stack:** PostgreSQL 17, Node.js 22, TypeScript, `pg` 8.23.0, Vitest e Node Test Runner, Firestore Emulator, Supabase CLI 2.114.0 para nomear a migration.

**Spec:** `docs/superpowers/specs/2026-09-12-operational-postgres-design.md`.

## Global Constraints

- Manter o login do sistema, o OAuth do MCP e a aplicação na Vercel.
- O Firestore permanece como fonte principal até que todas as entradas de escrita do núcleo tenham sido adaptadas e verificadas.
- A mudança de banco não concede permissões nem habilita escrita pelo Claude.
- A execução desta etapa usa dados sintéticos no emulador e banco local descartável. A importação hospedada e o teste com dados reais pertencem ao piloto seguinte.
- Credenciais de produção, projetos Supabase existentes e contêineres de outros sistemas permanecem fora da execução.

## Contratos

```ts
type SourceRecord = {
  collection: OperationalCollection;
  id: string;
  version: string; // nanossegundos de updateTime, inteiro decimal sem perda de precisão
  data: Record<string, unknown>; // JSON validado, não finitos/objetos especiais rejeitados
};
type OperationalSnapshot = {
  formatVersion: 1;
  sourceProject: string;
  capturedAt: string;
  completeCollections: OperationalCollection[];
  records: SourceRecord[];
};
```

Coleções: `salesOrders`, `stockUpdates`, `supplies`, `supplyCodes`, `inventoryMovements`, `productionColumns`, `productionLots`, `productionLotItems`, `productionComments` e somente os contadores `production-lots-AAAA` em `operationsMetadata`. IDs de documentos e valores `data.id` são distintos e preservados. A ordem do array de itens do pedido é parte do contrato.

## Task 1: Schema e isolamento

Arquivos: `supabase/operational/migrations/20260912154522_operational_core.sql` (nome criado pelo CLI), `scripts/operational-postgres-local.mjs`, `tests/postgres/operational.integration.ts`.

- [x] Criar testes de integração que inicialmente falham pela ausência das tabelas e dos módulos de importação/leitura.
- [x] Criar `brsteel_ops` com as dez tabelas de documentos e itens de pedido separados, preservando JSONB completo para conferência. Acrescentar índices de datas, filtros comerciais, SKU e relações de produção.
- [x] Criar `brsteel_import` com runs, checkpoints e estado da cópia; funções de leitura não veem uma carga parcial como pronta.
- [x] Criar papéis sem login para importação e leitura; RLS em todas as tabelas, grants mínimos e sem concessões a `anon`, `authenticated` ou `PUBLIC`.
- [x] Executar migration num contêiner exclusivo, publicar porta somente em loopback, testar bloqueio de leitura anônima e gravação pelo papel de leitura e conferir constraints e índices pelo catálogo.

## Task 2: Snapshot, importador e reconciliação

Arquivos: `src/server/migration/operational-snapshot.ts`, `src/server/migration/operational-import.ts`, `scripts/operational-import.ts`, `tests/operations/operational-snapshot.test.ts`, `tests/postgres/operational.integration.ts`.

- [x] Escrever primeiro testes de coleção indevida, IDs duplicados, JSON inválido, versões inválidas, referências órfãs e ausência da declaração de coleção completa. Datas e estruturas legadas ficam em payload; campos obrigatórios de vínculos devem ser válidos.
- [x] Implementar normalização determinística, hash do snapshot e de cada documento; exportar apenas as coleções permitidas do emulador, com updateTime e paginação. Não carregar usuários nem segredos.
- [x] Implementar importação com lock exclusivo, identidade de origem fixa, upsert versionado e checkpoint no mesmo commit do lote. Repetir snapshot concluído é no-op; retomar snapshot incompleto começa no checkpoint. Mesma versão com conteúdo diferente e versão regressiva são erros.
- [x] Ao concluir um snapshot completo, marcar documentos ausentes como excluídos da origem; manter exclusão lógica do payload separada. Excluir/recriar itens derivados de cada pedido no mesmo lote; rejeitar uma origem diferente no mesmo destino.
- [x] Conferir conteúdo normalizado lido do banco, contagens, hashes, referências e itens; liberar a cópia somente depois de conferência bem-sucedida. Não confiar apenas no hash gravado pelo importador.
- [x] Testar interrupção entre lotes, retomada, duplicação, atualização, exclusão, conflito de versão, concorrência de importação e rollback de lote inválido. CLI só aceita destino loopback e banco `brsteel_ops_local`, exige modo explicitamente local e não imprime payloads/segredos em erros.

## Task 3: Leitura SQL e encerramento

Arquivos: `src/server/persistence/postgres-sales.ts`, `src/server/persistence/postgres-read.ts`, `src/types/operations.ts`, `supabase/operational/README.md`, `docs/evidence/operational-postgres-phase2.md`.

- [x] Implementar `createPostgresSalesRepository(pool)` com o contrato da etapa 1. Listagem/detalhe reconstituem o documento original e os itens na ordem original; resumo agrega no SQL. Origem é `postgres`, sem alteração do export ativo em `persistence/sales.ts`.
- [x] Comparar resumo, filtros, cursores, páginas, detalhe e período vazio com o repositório Firestore usando os mesmos dados sintéticos; repetir as consultas com papel restrito e comprovar que carga incompleta é indisponível.
- [x] Cobrir estoque e produção nesta etapa por schema, preservação, vínculos e conferência. Seus adaptadores finais e agregação de demanda terão uma entrega própria antes do piloto, pois a primeira etapa estabilizou somente o contrato comercial. Essa divisão não declara essas leituras migradas.
- [x] Executar testes novos e suíte existente, typecheck comparado aos 25 diagnósticos da etapa 1 e build local; documentar o resultado real e as limitações.
- [x] Revisar o diff, salvar evidência, remover contêiner/volume temporários próprios e registrar commit local. Não publicar nem aplicar migration hospedada.

## Decisões de execução

A migration operacional fica fora do diretório de migrations OAuth existente para não ser aplicada incidentalmente ao provedor de identidade. A carga mantém o payload original, inclusive `itens`, e também cria a projeção de itens para consulta: a duplicação é intencional nesta versão para conferir a reconstrução; exige nova medição de espaço antes do piloto. O schema ainda não autoriza gravações de negócio em produção.

No snapshot completo, referências de lotes, itens, movimentos e chaves de SKU precisam resolver para registros presentes. Registros antigos incompatíveis geram erro de validação com coleção/ID, sem correção silenciosa. A primeira carga real será precedida dessa validação.

O export paginado não é um snapshot transacional do Firestore. A declaração de completude cobre as coleções enumeradas, não mudanças concorrentes durante a leitura; a reconciliação com escritores bloqueados continua obrigatória no corte.

## Resultado

Entrega local implementada e revisada. A evidência está em `docs/evidence/operational-postgres-phase2.md`. O encerramento deste plano cobre schema, importador e leitura candidata de vendas; os adaptadores de estoque e produção continuam pendentes na etapa 2 do roteiro.
