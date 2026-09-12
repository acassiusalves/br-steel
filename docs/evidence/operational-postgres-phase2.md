# Preparação SQL e importação local — evidência de 12/09/2026

Foi implementada a primeira entrega da etapa 2: schema privado do núcleo, exportação local, importação retomável, conferência independente e adaptador candidato de vendas com agregação SQL. A aplicação e o MCP continuam em Firestore. Os adaptadores de estoque/produção ainda pertencem ao trabalho pendente da etapa 2.

Branch: `codex/operational-postgres-phase2`, baseada no commit `15ee2d106ffa8306d5acd1a143b873e9e13cb39c` da etapa 1. Checkout preservado em `/private/tmp/br-steel-postgres-phase1`.

## Resultados

| Verificação | Resultado |
| --- | --- |
| Suíte Vitest com Firestore Emulator | 175 testes, 31 arquivos, sem falhas |
| Integração PostgreSQL + Firestore + CLI | 8 testes, sem falhas |
| Catálogo SQL | 13 tabelas com RLS, 18 chaves estrangeiras, 22 índices |
| Supabase CLI advisors local, tipos security/performance, nível warn | Nenhum aviso ou erro retornado |
| Build Next.js com configuração de demonstração | Exit 0 |
| TypeScript | Exit 2; os mesmos 25 diagnósticos preexistentes da etapa 1, sem novos |

O build do projeto já ignora typecheck e lint; seu sucesso não elimina os diagnósticos registrados separadamente. Avisos de instrumentação/dependências do build são preexistentes.

Os testes exportam 12 documentos sintéticos distribuídos pelas dez coleções permitidas, incluindo referências entre produção, pedidos e insumos. Documentos de usuários e metadados de outro módulo são excluídos da exportação. Dados são normalizados para JSON, incluindo timestamps com precisão preservada.

O ciclo cobre rollback integral de um lote inválido, interrupção após commit, retomada pelo checkpoint, repetição sem duplicação, exclusão da origem, atualização de versão, rejeição de origem trocada e conflitos de versão. Dois importadores concorrentes não intercalam checkpoints. Uma alteração manual do payload SQL é detectada pela conferência independente, mesmo sem alterar o hash armazenado.

O resumo comercial, filtros, duas páginas e cursores, detalhe, leitura por período e período vazio são comparados com o repositório Firestore usando a mesma base sintética. Há regressão para empate de produtos com IDs prefixados (`a` e `a-`) no limite dos dez primeiros resultados. Consultas com carga parcial retornam indisponibilidade.

Os papéis `anon` e `authenticated` têm acesso direto negado. O papel de leitura pode consultar a cópia pronta e não pode excluir pedidos nem ler o histórico interno de importação. RLS não substitui a autorização de cada usuário nas operações do backend; o adaptador candidato não foi conectado a endpoints ou ao MCP nesta entrega.

## Revisão e reprodução

A revisão independente encontrou e motivou regressões para perda de precisão de timestamps, falha ao liberar conexão após desconexão e ordenação incorreta em empates. A correção de timestamps foi refinada após reproduzir arredondamento para o dia seguinte junto à meia-noite. Os testes falharam antes das correções e passaram depois; a revisão final não deixou achados pendentes nesse escopo.

```sh
BRSTEEL_PG_ADVISORS=1 npm run test:postgres
PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH firebase emulators:exec --only firestore --project demo-brsteel-auth --config firebase.test.json 'npx --no-install vitest run'
npm run typecheck
```

O build foi executado com `npm run build`, projeto Firebase `demo-brsteel-auth`, endpoints de emulador em loopback, segredo de sessão fictício e telemetria Next.js desativada. Não foram copiados `.env.local`, `service-account.json` ou credenciais hospedadas para o checkout.

A migration foi nomeada pelo Supabase CLI e mantida em `supabase/operational/migrations`, separada das migrations OAuth. Foi aplicada diretamente ao PostgreSQL descartável e verificada pelo catálogo; não houve alteração de histórico de migrations hospedado. O teste usa PostgreSQL 17.6 de imagem Supabase com cluster inicializado vazio, sem simular toda a plataforma Supabase hospedada.

Para os advisors, a configuração OAuth do repositório exigia chaves locais ausentes; foi substituída por configuração temporária própria. O CLI também exigia TLS por padrão; foi configurado `sslmode=disable` somente na conexão loopback do teste. A execução final dos advisors concluiu sem problemas. Contêiner, volume e diretório temporário próprios foram removidos ao encerrar.

Os comandos e hashes de logs/arquivos estão no [registro estruturado](operational-postgres-phase2.json). O procedimento e contrato estão em [supabase/operational/README.md](../../supabase/operational/README.md).

## Limites e próximo trabalho

Não houve push, merge, deploy, alteração de plano ou importação de dados de produção. Os documentos MCP preexistentes no checkout principal foram preservados. Esta entrega não reduz ainda o consumo de leituras.

Antes do piloto hospedado: implementar os adaptadores de estoque e produção e a agregação de demanda; validar registros legados reais e reconciliar a cópia; medir armazenamento, tráfego e latência com esse schema. O payload de pedidos e a projeção de itens duplicam parte do conteúdo, portanto o tamanho do protótipo anterior não comprova a capacidade desta versão no plano gratuito.

A gravação de negócios, a unicidade de SKU, as transações de saldo e contador, os escritores externos, a recuperação de backup e a troca coordenada da fonte continuam nas etapas seguintes do [roteiro](../superpowers/specs/2026-09-12-operational-postgres-design.md). A exportação paginada não oferece um snapshot transacional de uma origem em movimento.
