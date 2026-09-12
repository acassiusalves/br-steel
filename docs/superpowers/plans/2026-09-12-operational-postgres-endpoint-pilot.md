# Piloto dos leitores PostgreSQL nos endpoints MCP

> **For agentic workers:** Use superpowers:executing-plans para implementação e superpowers:requesting-code-review para revisão antes da publicação.

**Goal:** Testar leitura da cópia operacional pelos endpoints HTTPS da Vercel com OAuth real, permissões efetivas e métricas de resposta.

**Architecture:** Seleção por flag e lista explícita de usuários apenas no MCP. As definições de ferramentas recebem as mesmas operações autorizadas com repositórios candidatos; o aplicativo web mantém os seletores atuais. Cada leitura SQL confere o snapshot esperado na mesma transação e informa que os dados pertencem a uma cópia.

**Tech Stack:** Next.js 15, MCP SDK 1.29, pg 8.23, AsyncLocalStorage, Supabase PostgreSQL 17 e OAuth, Firebase de homologação.

**Spec:** ../specs/2026-09-12-operational-postgres-design.md, continuação da etapa 3.

## Restrições

- Publicar somente no projeto Vercel `prj_YD3ATzBPFQo4bD1ZlojrDTigUZp8`, domínio `br-steel-mcp-staging.vercel.app`; identidade em `brsteel-mcp-staging`.
- A cópia permanece no Supabase `mlumbvxpaqfzpdjnvzxc`, origem `marketflow-9h4tg`. Não alterar dados operacionais reais nem o domínio/ambiente de produção.
- Usar uma conta sintética exclusiva, criada e removida pelo ensaio, com consentimento e token OAuth do provedor. Não modificar usuários reais.
- Nenhuma ferramenta de escrita; sem consulta Bling, fallback em falha de PostgreSQL, sincronização contínua ou upgrade.
- Login PostgreSQL restrito a leitura, TLS verificado, pool de uma conexão, consulta limitada a 30 s, expiração do piloto e da cópia em até 24 horas.
- Encerrar acesso e sessões PostgreSQL e remover a conta sintética ao final. Manter código e evidência; piloto não constitui migração da fonte oficial.

## 1. Seleção e metadados

Arquivos: `src/server/mcp/read-tools.ts`, `registry.ts`, `postgres-pilot.ts`; `src/server/operations/sales.ts`; `src/server/persistence/postgres-read.ts`, `pilot-snapshot.ts`; migration operacional de metadados e `operational-import.ts`.

- [x] Testar flag desativada, usuário fora da lista, origem web, flag/configuração inválida, expiração e isolamento entre chamadas.
- [x] Extrair `createSalesReadOperations(repository)` mantendo os exports atuais. Introduzir `createReadTools(operations)` sem alterar projeções ou autorização.
- [x] Configuração `MCP_PG_PILOT_ENABLED`, `MCP_PG_PILOT_USER_IDS`, `MCP_PG_PILOT_SNAPSHOT_HASH`, `MCP_PG_PILOT_EXPIRES_AT`, `MCP_PG_PILOT_DATABASE_URL`, `MCP_PG_PILOT_CA` apenas no servidor.
- [x] `withPilotSnapshot(policy, run)` vincula a chamada à cópia; `withOperationalSnapshot` confere `ready`, origem, hash, captura e validade na transação antes dos dados. Acrescentar `readCopy: { mode:'pilot', sourceProject, snapshotHash, capturedAt, completedAt }` e aviso explícito, preservando datas das observações individuais.
- [x] Migration adiciona `captured_at`/`completed_at` ao singleton, preenche com a execução existente e obriga metadados quando pronto. Importações futuras mantêm esses campos atomicamente.

## 2. Prova automatizada

Arquivos: `scripts/mcp-staging-proof.ts` e auxiliares/testes próprios; testes MCP, operações e integração PostgreSQL.

- [x] Novo modo explícito `MCP_PG_PILOT_VERIFY=true`: reutiliza OAuth/login/consentimento/PKCE e limpeza de dados sintéticos; consulta período real 01/09–12/09 e espera `source:'postgres'`, hash esperado e aviso da cópia.
- [x] Validar administrador/vendedor/operador, usuário inativo, conexão revogada, token comum rejeitado, ferramentas ocultas/negadas e projeção de produção sem dados comerciais.
- [x] Medir duração e bytes HTTP das ferramentas em amostras limitadas, sem payloads/tokens no relatório; distinguir rede cliente/Vercel de egress Supabase.
- [x] Preservar o modo antigo com Firestore e testar configuração offline antes de qualquer chamada remota.

## 3. Publicação e conferência

- [x] Executar testes locais, integração e build. Comparar typecheck com os 25 diagnósticos existentes e revisar o código.
- [x] Aplicar apenas a migration operacional nova e conferir origem/hash/metadados; provisionar acesso temporário de leitura.
- [x] Preparar variáveis privadas no projeto de homologação, conferir upload sem segredos, preservar crons vazios e publicar o candidato.
- [x] Executar prova HTTPS, registrar desvios reais da integração OAuth compartilhada, latência e bytes. Não alterar configuração global OAuth para acomodar o ensaio.
- [x] Revogar login PostgreSQL, encerrar sessões e confirmar limpeza de usuários/dados sintéticos; conferir que produção continua no mesmo deployment.

## 4. Evidência

- [x] Atualizar README/spec e produzir `docs/evidence/operational-postgres-endpoint-pilot.{md,json}` com resultados e limites.
- [x] Commit local; nenhum merge ou promoção do candidato para o sistema em produção.


## Resultado do ensaio

Prova HTTPS aprovada em 12/09/2026: 36 chamadas, perfis e ciclo OAuth completos. Homologação restaurada; logins e sessões PostgreSQL encerrados; produção no mesmo deployment. [Evidência](../../evidence/operational-postgres-endpoint-pilot.md).

Duas correções no roteiro precederam a aprovação: exclusão do GET auxiliar do SDK das métricas de ferramentas e páginas de dez registros para atravessar os registros sem nome da coleção de insumos. O runtime publicado permaneceu idêntico durante as três tentativas; todas encerraram seus dados sintéticos.
