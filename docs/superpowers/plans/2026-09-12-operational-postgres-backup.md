# Backup e restauração do núcleo operacional

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Execute the approved recovery milestone without reopening prior approvals.

**Goal:** Comprovar backup criptografado da cópia hospedada e restauração integral dos dois schemas operacionais em PostgreSQL descartável, medindo tempo e tráfego.

**Architecture:** Um papel de backup independente recebe somente SELECT e políticas RLS explícitas. `pg_dump` usa TLS verificado, os dois schemas por nome e um snapshot exportado; o arquivo é criptografado com age. A restauração usa um contêiner local novo, preserva grants e RLS e compara fingerprints completos e catálogo. Credenciais temporárias são revogadas e contêineres removidos ao encerrar.

**Tech Stack:** PostgreSQL 17, pg_dump 17.11/pg_restore 17.6, Node 22, pg, Docker, age.

**Spec:** `docs/superpowers/specs/2026-09-12-operational-postgres-design.md` — orçamento e recuperação; autorização atual do usuário para seguir a etapa proposta.

## Global Constraints

- Projeto `mlumbvxpaqfzpdjnvzxc`; origem `marketflow-9h4tg`; schemas `brsteel_ops` e `brsteel_import`.
- Produção permanece Firestore. Não alterar OAuth, dados de negócio, Vercel, preços ou plano. Não restaurar sobre banco existente.
- Papel de backup separado de runtime/importador, sem superuser/BYPASSRLS/gravação; login temporário com prazo, revogado ao encerrar.
- Conteúdo real e chaves ficam fora de Git, com permissões privadas. Relatórios contêm somente contagens, hashes, tempos, bytes e verificações.
- Manter arquivo criptografado e chave em locais privados separados deste computador; isto é artefato do ensaio, ainda não armazenamento externo durável nem operação diária.
- Objetivos propostos: perda máxima de 24h e recuperação em até 2h. O ensaio não comprova agendamento, custódia externa, recuperação total do provedor ou sincronização Firestore.
- Sem push/merge nesta etapa; commit local após verificação e revisão.

### Task 1: Papel de backup com acesso mínimo

**Files:** nova migration `*_operational_backup_role.sql` gerada com `supabase migration new`; novo `tests/postgres/backup.integration.ts`.

**Interfaces:** papel `brsteel_ops_backup` NOLOGIN, INHERIT, NOSUPERUSER, NOCREATEDB, NOCREATEROLE, NOREPLICATION, NOBYPASSRLS; USAGE apenas nos dois schemas, SELECT e política `backup_reader` FOR SELECT USING(true) nas 13 tabelas existentes. Não criar login nem conceder membership a qualquer papel existente. Não usar grants de tabelas futuras. O controlador provisionará um login separado temporário.

- [x] Testar primeiro a ausência do papel como falha real no PostgreSQL descartável. Usar o runner `npm run test:postgres` existente, exclusivamente.
- [x] Criar migration via CLI e mover para `supabase/operational/migrations`, fora do OAuth. Aplicar alterações transacionais. Para cada tabela: `GRANT SELECT ON ... TO brsteel_ops_backup; CREATE POLICY backup_reader ON ... FOR SELECT TO brsteel_ops_backup USING (true);`.
- [x] Provar leitura das 13 tabelas e import runs; provar falha 42501 em INSERT/UPDATE/DELETE/TRUNCATE, mudança para importador, criação de tabela e leitura de schema estranho. Comprovar atributos do papel e ausência de associação a leitor/importador. Políticas e permissões de anon/authenticated permanecem bloqueadas.
- [x] Executar integração, registrar teste vermelho/verde e entregar diff para revisão. Não modificar runtime, documentação geral ou scripts do controlador; não provisionar nada hospedado e não fazer commit.

### Task 2: Roteiro de backup e recuperação

**Files:** `scripts/operational-backup-drill.mjs`, helpers em `scripts/lib/operational-backup.mjs`, testes `tests/backup/*.test.ts`, documentação `supabase/operational/README.md`.

**Interfaces:** entrada explícita por ambiente para URL de backup, CA, hash da cópia, diretório privado de saída e identidade age; destino da restauração sempre gerado pelo próprio roteiro. Backup não recebe URL de destino externo.

- [x] Testes de guardas para projeto/usuário/host/porta, hash, arquivos privados e comparação integral que falha se linhas/catálogo/permissões divergirem.
- [x] Implementar configuração fechada no pooler de sessão `aws-0-sa-east-1.pooler.supabase.com:5432`, usuário `brsteel_backup_probe.mlumbvxpaqfzpdjnvzxc`, database `postgres`, sem parâmetros de URL, TLS verify-full. Nunca imprimir erro SQL ou stderr contendo dados.
- [x] Capturar manifesto de 13 tabelas e hash SHA256 de cada linha completa, agregado com ordenação determinística; catálogo de colunas, constraints, índices, RLS, políticas e grants. Exportar snapshot em transação REPEATABLE READ READ ONLY e usar o mesmo em `pg_dump --format=custom --schema=brsteel_ops --schema=brsteel_import --enable-row-security --snapshot=...`.
- [x] Medir bytes TCP recebidos/enviados pelo dump mediante proxy local transparente e TLS verificado de ponta a ponta; separar tamanho comprimido/criptografado e consultas de verificação. Estes bytes não são a fatura Supabase.
- [x] Criptografar em streaming com age sem persistir dump plano; descriptografar e restaurar somente dentro de PostgreSQL descartável, sem rede externa, `pg_restore --no-owner --exit-on-error --single-transaction`. Criar somente papéis NOLOGIN necessários; manter ACLs/policies do arquivo.
- [x] Comparar manifesto restaurado, metadados da cópia, 18 FKs, 13 tabelas com RLS, restrições e acesso anônimo; demonstrar leitura e bloqueio de gravação para backup. Provar falha para arquivo criptografado adulterado e limpeza após erro.

### Task 3: Ensaio hospedado, encerramento e evidência

**Files:** `docs/evidence/operational-postgres-backup.{md,json}`, atualização do spec e deste plano.

- [x] Revisar mudanças SQL localmente, aplicar migration no projeto correto; criar login temporário com senha privada, prazo curto e SELECT via papel de backup, limite de duas conexões.
- [x] Antes do dump, comparar contagens/hashes privilegiados com a leitura do papel de backup para evitar cópia silenciosamente filtrada por RLS. Confirmar cópia pronta e sem escritores do piloto ativos.
- [x] Executar backup, descriptografia e restauração local, registrar tempo total de recuperação e conteúdo equivalente. Medir projeções de 30 backups por ciclo e retenção de 11 arquivos, sem afirmar economia mensal.
- [x] Revogar login/senha/membership, encerrar sessões e conferir 0 sessões; limpar credenciais locais temporárias e contêiner/volume próprios. Confirmar hash/captura/prontidão intactos.
- [x] Revisão final, verificações apropriadas, commit local e evidência copiada para workspace principal preservando alterações alheias. Próxima etapa continua sendo teste direto no Claude e consumo em uso controlado.
