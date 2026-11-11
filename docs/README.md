# Documentação do BR Steel

## Desenvolvimento

- [Regras do projeto](../AGENTS.md) e [visão geral do repositório](../README.md).
- [Desenvolvimento local](desenvolvimento-local.md) para instalação, fixtures e testes.
- [Arquitetura](arquitetura.md) e [qualidade](qualidade.md) para localizar contratos e validar mudanças.
- [Adoção do toolkit](setup-toolkit.md) para consultar as ferramentas, as escolhas e a verificação local.
- [Regras e índices do Firestore](firestore.md) para mudanças versionadas e publicação com destino explícito.
- [Catálogo de scripts](../scripts/README.md) para escolher o comando e entender seu efeito antes de executar.
- [Provedor OAuth local do MCP](mcp-oauth-provider-local.md) para testar o fluxo com um provedor dedicado.

## Procedimentos por ambiente

Confirme o destino e o estado atual antes de seguir um procedimento datado. Valide as variáveis pelo nome e mantenha os valores fora do Git.

| Área | Referência |
| --- | --- |
| MCP em homologação | [Guia de homologação](mcp-homologacao.md), [exemplo de ambiente](../config/mcp-staging.env.example) e [configuração Vercel sem crons](../config/vercel.mcp-staging.json). |
| MCP em produção | [Registro de publicação e recuperação](mcp-producao.md) e [exemplo de ambiente](../config/mcp-production.env.example). Confira os crons atuais no [vercel.json](../vercel.json). |
| OAuth local | [Guia do provedor](mcp-oauth-provider-local.md) e [migrations locais](../supabase/migrations/). |
| OAuth hospedado | Procedimentos SQL de [homologação](../supabase/hosted/README.md), [produção](../supabase/hosted/production/README.md) e [roteamento de consentimento](../supabase/hosted/consent-routing/README.md). |
| Migração do Supabase | [Registro de 11/11/2026 e troca pendente em produção](migracao-supabase-2026-11.md). |
| Banco operacional | [Visão geral e cadeia SQL manual](../supabase/operational/README.md), [ensaio de cutover](../supabase/operational/cutover-rehearsal.md) e [ensaio de backup e restauração](../supabase/operational/backup-restore.md). |

As trilhas de OAuth local, OAuth hospedado e banco operacional têm destinos e ciclos de aplicação próprios. A fonte operacional ativa depende do seletor em runtime. O código do [seletor de persistência](../src/server/persistence/source.ts) descreve o contrato, e o procedimento operacional orienta como verificar o ambiente.

## Registros históricos

- [Blueprint do Firebase Studio](historico/blueprint-firebase-studio.md) registra o protótipo inicial.
- [Conciliação](analise-conciliacao-faturamentto-clientes.md), [plano de teste](plano-teste-conciliacao.md) e [reteste](plano-reteste-conciliacao.md) registram o trabalho anterior de Financeiro.
- [Etapa 1](mcp-etapa-1.md), [etapa 2](mcp-etapa-2.md), [etapa 3](mcp-etapa-3.md) e [etapa 4](mcp-etapa-4.md) registram a implementação do MCP.
- [Avaliação de capacidade](avaliacao-supabase-free-2026-09-12.md) e [medições PostgreSQL](medicoes-postgresql-2026-09-12.md) registram as condições dos ensaios de setembro de 2026.
- [Planos](superpowers/plans/) e [desenhos](superpowers/specs/) registram decisões e etapas propostas. [Evidências](evidence/) descrevem verificações em datas e ambientes específicos. Use as regras de publicação do [AGENTS.md](../AGENTS.md) para novos registros.
