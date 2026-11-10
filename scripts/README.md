# Scripts do BR Steel

Execute da raiz do repositório. Os comandos npm estão em [package.json](../package.json). Use o [guia local](../docs/desenvolvimento-local.md) para o fluxo de desenvolvimento e testes. Antes de executar um script que recebe um arquivo de ambiente, confira o projeto, o host e o banco pelos quais ele pode ler ou gravar.

## Desenvolvimento e CI

| Arquivo | Efeito |
| --- | --- |
| [`ci/typecheck-baseline.mjs`](ci/typecheck-baseline.mjs) | Executa o TypeScript e compara os diagnósticos com a baseline. Entrada `npm run typecheck:ci`. |
| [`seed-operations-local.cjs`](seed-operations-local.cjs) | Limpa e repovoa o projeto demo emulado com fixtures. Uso manual, separado das suítes que compartilham a porta. |
| [`operational-postgres-local.mjs`](operational-postgres-local.mjs) | Entrada de `npm run test:postgres`. Usa PostgreSQL em container descartável e Firestore emulado. |
| [`operational-import.ts`](operational-import.ts) | Exporta do emulador, importa snapshot no PostgreSQL local ou verifica a cópia. Mantenha os snapshots em local privado. |
| [`oauth-provider-local.mjs`](oauth-provider-local.mjs) e [`oauth-provider-verify.mjs`](oauth-provider-verify.mjs) | Iniciam o provedor OAuth local dedicado e verificam seu contrato com dados sintéticos. |
| [`oauth-app-verify.mjs`](oauth-app-verify.mjs) e [`oauth-app-verify.ts`](oauth-app-verify.ts) | Executor e implementação das provas OAuth/MCP da aplicação local. Use a configuração descrita no [guia OAuth](../docs/mcp-oauth-provider-local.md). |
| [`mcp-local-proof.ts`](mcp-local-proof.ts) | Prova local do MCP com o provedor OAuth dedicado e o emulador. |
| [`render-chart-preview.tsx`](render-chart-preview.tsx) | Gera uma prévia local do gráfico de produção em `chart-preview.html`. |

## MCP e ambientes hospedados

| Arquivo | Efeito |
| --- | --- |
| [`mcp-staging-check.ts`](mcp-staging-check.ts) | Valida ambiente e configuração de publicação da homologação. |
| [`mcp-production-check.ts`](mcp-production-check.ts) | Valida variáveis fornecidas e configuração de produção, sem chamadas de rede. |
| [`mcp-staging-proof.ts`](mcp-staging-proof.ts) | Na prova completa, cria fixtures no Firestore e registra um cliente OAuth no Supabase de homologação, com tentativa de limpeza ao final. Use a opção `--preflight-only` para validar a configuração sem rede. [Procedimento](../docs/mcp-homologacao.md) |

## Operação do banco e rotinas de integração

Use o [índice de documentação](../docs/README.md) para localizar o procedimento do ambiente. A opção de ensaio de um script pode ter efeitos no ambiente de origem ou destino.

| Arquivo | Efeito |
| --- | --- |
| [`operational-hosted-pilot.ts`](operational-hosted-pilot.ts) | Piloto de importação e leitura no PostgreSQL hospedado, com credenciais separadas por papel. |
| [`operational-backup-drill.mjs`](operational-backup-drill.mjs) | Lê o destino configurado para gerar backup criptografado ou restaura em PostgreSQL descartável local. |
| [`operational-cutover.ts`](operational-cutover.ts) | Comandos de reconciliação e controle do corte operacional. Revise o modo e o destino antes de usar `npm run cutover`. |
| [`operational-cutover-rehearsal.ts`](operational-cutover-rehearsal.ts) | Ensaio que pode acionar manutenção do Firestore e gravar no PostgreSQL de destino. |
| [`backfill-sku-weekly-demand.ts`](backfill-sku-weekly-demand.ts) | Recalcula demanda semanal e grava buckets e checkpoint no Firestore. |
| [`print-ml-token.ts`](print-ml-token.ts) | Imprime um token de Mercado Livre. Se precisar renová-lo, grava as credenciais atualizadas no Firestore configurado. Mantenha a saída fora dos logs e artefatos. |
| [`refresh-claude-ml-token.ts`](refresh-claude-ml-token.ts) | Obtém o token de Mercado Livre e atualiza a configuração pessoal do Claude, com cópia de backup. Uma renovação também grava no Firestore configurado. |
| [`test-ml-mcp.ts`](test-ml-mcp.ts) | Diagnóstico manual com serviços reais de Mercado Livre e Firebase. Uma renovação de token também grava no Firestore configurado. |
| [`calculaqui-gcf-forwarder.patch`](calculaqui-gcf-forwarder.patch) | Patch de referência para a integração externa do Calculaqui. |

## Módulos auxiliares

Os arquivos em `lib/` são importados pelos executores acima. Use o script principal como entrada.

- Conexão e backup operacional. [`cutover-pool.ts`](lib/cutover-pool.ts) · [`operational-backup.mjs`](lib/operational-backup.mjs)
- Configuração e provas de MCP. [`mcp-postgres-proof.ts`](lib/mcp-postgres-proof.ts) · [`mcp-production-config.ts`](lib/mcp-production-config.ts) · [`mcp-staging-config.ts`](lib/mcp-staging-config.ts) · [`mcp-staging-proof-guard.ts`](lib/mcp-staging-proof-guard.ts)
