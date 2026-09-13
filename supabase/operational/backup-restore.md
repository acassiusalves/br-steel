# Ensaio de backup e restauração

O roteiro `scripts/operational-backup-drill.mjs` comprova recuperação da **cópia operacional**. A fonte oficial do sistema continua no Firestore. Ele não agenda backups nem restaura Auth, Storage, configurações OAuth, Vercel ou o projeto Supabase inteiro.

[Resultado medido em 12/09/2026](../../docs/evidence/operational-postgres-backup.md).

## Pré-requisitos e acesso

- Node 22, dependências do projeto, `age`/`age-keygen`, cliente `pg_dump` 17 e Docker com endpoint Unix local. A imagem de restauração é `public.ecr.aws/supabase/postgres:17.6.1.167`; não há portas publicadas nem rede no contêiner. Contextos Docker remotos são recusados.
- Aplicar a migration operacional de backup. `brsteel_ops_backup` é NOLOGIN, sem privilégios administrativos, e lê somente as 13 tabelas atuais com RLS. Tabelas futuras exigem revisão explícita; o roteiro recusa um catálogo diferente.
- Provisionar, por conexão administrativa confiável, um login temporário chamado `brsteel_backup_probe`, INHERIT, NOSUPERUSER, NOCREATEDB, NOCREATEROLE, NOREPLICATION, NOBYPASSRLS, limite de duas conexões e validade curta. Conceder somente `brsteel_ops_backup`. Nunca usar o login de runtime ou importação. Não registrar senha na migration ou em Git.
- O roteiro não cria nem revoga esse login. O operador deve fazer a revogação abaixo **mesmo após uma falha ou interrupção**. Expiração é proteção adicional, não substitui a revogação.

## Preparação privada

Criar um diretório novo, modo `0700`, fora de qualquer checkout ou pasta sincronizada pública. Criar uma identidade age, modo `0600`, em outro diretório privado. Chave e arquivo precisam de custódias independentes antes de produção. No ensaio ambos ficam neste computador; isso não protege contra perda do computador.

Definir as variáveis no ambiente privado do processo:

| Variável | Conteúdo |
|---|---|
| `BRSTEEL_BACKUP_DIRECTORY` | Diretório novo, absoluto, privado e fora do repositório |
| `BRSTEEL_BACKUP_IDENTITY` | Arquivo privado da identidade age, fora do diretório do arquivo |
| `BRSTEEL_BACKUP_URL` | URL do login temporário no pooler `aws-0-sa-east-1.pooler.supabase.com:5432`, usuário `brsteel_backup_probe.mlumbvxpaqfzpdjnvzxc`, banco `postgres`; sem query string |
| `BRSTEEL_BACKUP_CA` | CA obtida do projeto; TLS verifica cadeia e hostname |
| `BRSTEEL_BACKUP_SNAPSHOT_HASH` | Hash de 64 caracteres minúsculos da cópia esperada |
| `BRSTEEL_BACKUP_PRIVILEGED_MANIFEST` | JSON agregado capturado pela conexão administrativa confiável |
| `BRSTEEL_BACKUP_PG_BIN` | Pasta dos binários PostgreSQL 17; padrão macOS `/opt/homebrew/opt/libpq@17/bin` |

O manifesto privilegiado tem a forma `{tables:[{name,rows,sha256}],catalog:{...}}`. Gerar as consultas com `tableManifestSql` para os nomes de `tables` e `catalogSql`, exportados por `scripts/lib/operational-backup.mjs`. Executar com `timezone=UTC`, `extra_float_digits=3`, `search_path=pg_catalog`, ordenar tabelas por nome e salvar apenas contagens/hashes/catálogo. Não exportar payloads para o manifesto. A cópia deve permanecer estável entre esta captura e a execução. Se houver divergência, investigar; não substituir automaticamente a referência por dados do papel de backup.

Essa comparação administrativa é necessária porque `pg_dump --enable-row-security` exporta somente as linhas que o papel pode ler. O roteiro compara as 13 tabelas antes do dump, depois mantém uma transação `REPEATABLE READ READ ONLY` e usa o mesmo snapshot exportado no dump. Veja a [documentação do PostgreSQL](https://www.postgresql.org/docs/17/app-pgdump.html).

## Execução e verificação

```sh
node scripts/operational-backup-drill.mjs backup
```

O dump em formato custom é comprimido e criptografado por streaming, sem arquivo plano no disco. `operational.dump.age`, `manifest.json` e `drill.json` são privados e não substituem backups anteriores. O proxy local mede bytes TCP, preservando TLS até o Supabase; somente o download do dump entra nesse contador, não as consultas de preparação.

A restauração usa apenas um contêiner novo com `pg_restore --no-owner --single-transaction --exit-on-error`. Os papéis necessários são recriados sem login. Não remover ACLs, RLS ou constraints para fazer uma restauração passar. O roteiro compara hashes de linhas completas, colunas e expressões geradas, constraints, índices, políticas, grants e defaults de privilégios. Em seguida comprova leitura pelo papel de backup e rejeição de UPDATE.

Antes da restauração válida, o roteiro adultera uma cópia do arquivo criptografado: o processo deve falhar e o banco continuar sem os schemas operacionais. A cópia adulterada é removida. O contêiner e seu volume são removidos ao encerrar, inclusive em falha e SIGINT/SIGTERM; SIGKILL ou perda do host impedem qualquer `finally`.

Para repetir a recuperação do mesmo arquivo, inclusive após revogar a credencial hospedada:

```sh
node scripts/operational-backup-drill.mjs restore
```

Este modo requer somente diretório, identidade age e hash esperado, cria um novo banco descartável e não consulta o Supabase. Cada execução gera `restore-<timestamp>.json`. Ler `status`, verificações e `cleanup`; exit code zero é obrigatório. Depois de uma interrupção não recuperável, conferir contêineres com label `brsteel.purpose=backup-restore` e remover apenas o contêiner/volume identificado como pertencente ao ensaio.

## Encerramento da credencial hospedada

Na conexão administrativa confiável, após o ensaio:

```sql
begin;
alter role brsteel_backup_probe nologin password null;
revoke brsteel_ops_backup from brsteel_backup_probe;
commit;
select pg_terminate_backend(pid)
from pg_stat_activity
where usename='brsteel_backup_probe' and pid<>pg_backend_pid();
```

Em uma consulta posterior, confirmar zero sessões, NOLOGIN, senha nula e nenhuma associação a papéis. A terminação de sessões não é necessariamente instantânea. Remover o arquivo privado de credenciais temporárias; guardar somente o arquivo criptografado, manifesto, relatórios e identidade necessária à recuperação. Conferir que o manifesto da origem permaneceu igual.

## Antes de operar em produção

A meta proposta de perda máxima de 24h exige backups diários funcionando e monitorados; a execução manual não a atende sozinha. A meta de recuperação de 2h também precisa incluir provisionamento de destino hospedado, obtenção da chave, transferência do arquivo e reconfiguração da aplicação.

Definir armazenamento externo durável, custódia da chave, retenção de sete cópias diárias e quatro semanais, alertas de falha e ensaios regulares. Não ativar agendamento ou contratar serviços a partir deste roteiro. No Free, o Supabase recomenda exportações regulares e cópias fora do projeto. [Backups Supabase](https://supabase.com/docs/guides/platform/backups).
