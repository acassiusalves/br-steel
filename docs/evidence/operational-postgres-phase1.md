# Primeira etapa da migração operacional — evidência

Concluída localmente em 12/09/2026 na branch `codex/operational-postgres-phase1`, baseada em `cb6399cf1fe9d7906299604b3d03fc26ad6729c1`. Checkout: `/private/tmp/br-steel-postgres-phase1`.

As operações públicas de vendas mantêm autorização, validação e assinaturas. As consultas e os cálculos existentes foram extraídos para `src/server/persistence/firestore-sales.ts`, com contrato em `sales-contract.ts` e seleção fixa de Firestore em `persistence/sales.ts`. Nenhum adaptador PostgreSQL foi ativado.

Foram preservados os filtros, IDs, cursores, ordenação, períodos de comparação, tratamento de números não finitos, avisos de base vazia e erros de registro ausente/indisponibilidade. A demanda de produção continua autorizando sua própria projeção; o acesso financeiro continua separado do comercial. Os nove testes novos cobrem esses limites, agregados e paginação com datas iguais.

## Resultados

| Verificação | Resultado |
| --- | --- |
| Caracterização antes da extração | 8 testes em 2 arquivos passaram |
| Novo contrato antes da implementação | Falha esperada: módulo do repositório inexistente; casos ainda não executáveis |
| Vendas após a extração | 11 testes em 3 arquivos passaram |
| Suíte completa | **169 testes em 29 arquivos passaram**, código de saída 0 |
| TypeScript antes e depois | **25 diagnósticos preexistentes idênticos**, código de saída 2; nenhum diagnóstico novo |
| Build local | **Passou**, código de saída 0 |
| Revisão local do diff | Sem divergência de comportamento identificada frente ao plano e ao código original |

O build apresentou avisos de dependências OpenTelemetry e Handlebars. A configuração existente do Next.js ignora a validação de tipos e lint no build; por isso o TypeScript foi executado separadamente e não é declarado como aprovado.

## Como foi verificado

Node.js 22.19.0, Java 21 instalado em `/opt/homebrew/opt/openjdk@21`, dependências próprias do checkout instaladas por `npm ci --no-audit --no-fund`, sem mudança de lockfile. Uma tentativa inicial de reaproveitar `node_modules` falhou por módulos ausentes; essa instalação foi substituída antes das verificações válidas.

Os testes usaram somente o emulador Firestore em `127.0.0.1:8188`, projeto `demo-brsteel-auth`. Não foram copiados `.env.local` ou `service-account.json` para o checkout. O emulador foi encerrado pelo CLI ao fim de cada execução.

```sh
PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH firebase emulators:exec --only firestore --project demo-brsteel-auth --config firebase.test.json 'npx --no-install vitest run'
npm run typecheck
```

O build usou variáveis locais de demonstração:

```sh
FIREBASE_PROJECT_ID=demo-brsteel-auth NEXT_PUBLIC_FIREBASE_PROJECT_ID=demo-brsteel-auth FIRESTORE_EMULATOR_HOST=127.0.0.1:8188 NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST=127.0.0.1:8188 FIREBASE_STORAGE_BUCKET=demo-brsteel-auth.firebasestorage.app AUTH_SESSION_SECRET=local-phase1-build-secret-not-for-production NEXT_TELEMETRY_DISABLED=1 npm run build
```

Os resumos estruturados e hashes dos arquivos e logs estão em [operational-postgres-phase1.json](operational-postgres-phase1.json). Logs locais desta execução: `/private/tmp/brsteel-pg-phase1-{characterization,repository-red,focused-green,full-tests,baseline-typecheck,final-typecheck,build}.log`.

## Estado da entrega

As alterações ficam na branch local. Não houve push, merge, deploy, mudança de plano, importação hospedada ou alteração de banco/credenciais de produção. As alterações preexistentes dos documentos MCP no checkout principal foram preservadas. Esta etapa prepara a persistência para a migração; ainda não reduz leituras nem transfere dados para PostgreSQL.

A próxima entrega é modelar o núcleo no SQL e preparar carga idempotente e conferência em ambiente isolado, conforme o [roteiro](../superpowers/specs/2026-09-12-operational-postgres-design.md).
