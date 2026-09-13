# Provisionamento para o ensaio do corte (etapa 5, Task 3)

O código do corte está pronto e testado: interruptor de manutenção, reconciliação, comparador e seletor trocável em runtime. O que falta é provisionamento, que envolve credenciais e por isso é seu.

**Nada aqui toca produção.** O destino é o Supabase `mlumbvxpaqfzpdjnvzxc` e o ambiente é a Vercel de homologação `br-steel-mcp-staging`. A aplicação de produção continua em Firestore o tempo todo — `appConfig/operationalSource` nem existe lá.

Guarde credenciais num arquivo privado fora do Git, com permissão `0600`. Nada deste roteiro deve ser colado em chat, issue ou PR.

---

## O que você precisa em mãos

| Item | Onde |
| --- | --- |
| Acesso de administrador ao Supabase `mlumbvxpaqfzpdjnvzxc` | SQL Editor do painel |
| Certificado raiz TLS do projeto | Painel → Settings → Database → SSL Configuration |
| Credencial de serviço do Firebase `marketflow-9h4tg` | para exportar os dados reais |
| Acesso ao projeto Vercel `br-steel-mcp-staging` | `prj_YD3ATzBPFQo4bD1ZlojrDTigUZp8` |
| Uma janela de ~1 hora | o ensaio mede tempos; interrupções distorcem a medição |

---

## Passo 1 — Aplicar as duas migrations pendentes

O piloto da etapa 3 aplicou as cinco primeiras migrations operacionais. **Duas são posteriores e ainda não estão no destino:**

| Arquivo | O que cria |
| --- | --- |
| `20260912234410_operational_writer_role.sql` | papel `brsteel_ops_writer`, schema `brsteel_write`, auditoria e idempotência |
| `20260912235500_operational_native_run.sql` | execução sentinela `NATIVE_RUN_ID` para linhas nativas |

Aplique **nessa ordem**, uma de cada vez, conferindo o resultado antes de seguir. A segunda depende da primeira apenas indiretamente, mas a ordem é a do histórico.

Conferência depois de aplicar:

```sql
-- Deve devolver uma linha, com todos os atributos em false exceto rolinherit.
select rolname, rolcanlogin, rolsuper, rolbypassrls, rolinherit
from pg_roles where rolname = 'brsteel_ops_writer';

-- Deve devolver 2: brsteel_write.audit e brsteel_write.idempotency, ambas com RLS.
select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'brsteel_write' and c.relkind = 'r' and c.relrowsecurity;

-- Deve devolver a execução sentinela.
select id, source_project, status from brsteel_import.runs where id = repeat('0', 64);
```

Se qualquer uma falhar, **pare**: o restante do roteiro assume as três verdadeiras.

---

## Passo 2 — Provisionar o login temporário de runtime

O papel `brsteel_ops_writer` nasce `NOLOGIN` de propósito. Crie um login temporário associado a ele, com senha aleatória e prazo curto:

```sql
-- Troque <SENHA> por um valor aleatório de 32+ caracteres e <PRAZO> por algo como '2026-09-14 20:00+00'.
create role brsteel_ops_runtime login password '<SENHA>' valid until '<PRAZO>'
  nosuperuser nocreatedb nocreaterole noreplication nobypassrls inherit connection limit 4;
grant brsteel_ops_writer to brsteel_ops_runtime;
```

Conferência — o login **não** pode ter mais do que o papel concede:

```sql
-- Deve devolver exatamente brsteel_ops_writer.
select granted.rolname from pg_auth_members m
join pg_roles granted on granted.oid = m.roleid
join pg_roles member on member.oid = m.member
where member.rolname = 'brsteel_ops_runtime';
```

> **Uma associação a mais é esperada no hospedado.** `postgres` é membro de `brsteel_ops_writer` com `admin_option`, porque no PostgreSQL 16+ quem cria um papel recebe administração sobre ele — e o `postgres` do Supabase, ao contrário do de um contêiner local, não é superusuário. Não é escalonamento do escritor. O teste de integração local afirma zero associações e passa, justamente porque lá o criador é superusuário e dispensa o registro: **é um comportamento que a suíte local não consegue observar.**

O papel escritor já cobre leitura **e** escrita do núcleo: ele tem `SELECT` nas 13 tabelas de `brsteel_ops`, `SELECT` em `brsteel_import.state` e DML onde precisa. Não conceda nada além disso.

**Nunca use o login `postgres` no runtime.** O código recusa: `operationalPoolConfig` rejeita `postgres` e `postgres.<projeto>` explicitamente.

---

## Passo 3 — Copiar os dados reais para o destino

**A cópia do piloto ainda está no destino.** O que foi encerrado no piloto foram os *acessos*, não os dados — conferido em 13/09: 12.538 pedidos, 361 observações de estoque, 54 insumos, 3 lotes, marcada como pronta, capturada em 12/09 17:41 UTC.

Mesmo assim é preciso uma exportação nova, por dois motivos: a cópia é de ontem e o schema mudou desde então. **Não reaproveite um JSON antigo** — ele não prova compatibilidade com o schema atual.

A importação vai **reconciliar sobre a cópia existente**, não carregar do zero. É exatamente o caminho que a guarda de colisão entre linha nativa e documento de snapshot protege.

Prepare um arquivo privado de ambiente (`0600`, fora do Git) com os logins de piloto de importação, provisionados do mesmo jeito que o do Passo 2 mas associados a `brsteel_ops_importer`:

```
BRSTEEL_PG_SOURCE_PROJECT=marketflow-9h4tg
BRSTEEL_PG_PILOT_IMPORTER_URL=postgres://brsteel_pilot_importer.mlumbvxpaqfzpdjnvzxc:<SENHA>@aws-0-sa-east-1.pooler.supabase.com:5432/postgres
BRSTEEL_PG_CA_FILE=/caminho/privado/supabase-ca.crt
GOOGLE_APPLICATION_CREDENTIALS=/caminho/privado/marketflow-service-account.json
```

Depois:

```bash
node --env-file=/caminho/privado/cutover.env --conditions=react-server --import tsx scripts/operational-hosted-pilot.ts export /caminho/privado/snapshot.json
```

```bash
node --env-file=/caminho/privado/cutover.env --conditions=react-server --import tsx scripts/operational-hosted-pilot.ts import /caminho/privado/snapshot.json /caminho/privado/import-report.json
```

```bash
node --env-file=/caminho/privado/cutover.env --conditions=react-server --import tsx scripts/operational-hosted-pilot.ts verify /caminho/privado/snapshot.json /caminho/privado/verify-report.json
```

O `verify` relê os payloads e confere contagens, referências e projeções de forma independente — os digests que o importador gravou não são evidência. **Só siga se ele passar.**

O importador usa lock de sessão, então precisa do pooler em **modo sessão (5432)** ou conexão direta. O pooler transacional (6543) não serve para importar.

---

## Passo 4 — Configurar as variáveis em homologação

No projeto Vercel `br-steel-mcp-staging`, **não** em produção:

| Variável | Valor |
| --- | --- |
| `BRSTEEL_OPERATIONAL_DATABASE_URL` | `postgres://brsteel_ops_runtime.mlumbvxpaqfzpdjnvzxc:<SENHA>@aws-0-sa-east-1.pooler.supabase.com:5432/postgres` |
| `BRSTEEL_OPERATIONAL_CA` | conteúdo do certificado raiz, não o caminho |

Use **modo sessão (5432)** também aqui no ensaio. O modo transacional (6543) é o que a especificação recomenda para runtime serverless, mas ele rejeita alguns parâmetros de inicialização — entre eles o `statement_timeout` que o pool define. Validar o modo transacional é um item do ensaio, não uma premissa dele.

Confira que as variáveis **não** vazaram para produção antes de seguir.

---

## Passo 5 — Me avise

Com os quatro passos prontos, o ensaio é código que já existe e está testado. Ele roda assim:

`draining` → esperar as chamadas em trânsito → `blocked` → conferir que a fila parou de ser drenada → `reconcile` → `compare` → **exigir divergência zero** → trocar `operationalSource` para `postgres` → retomar a fila → `open`.

Depois, o retorno nos dois sentidos: antes de qualquer gravação oficial, e depois de gravações oficiais — que é o passo que prova que o corte é reversível.

Os comandos de reconciliação e comparação são `npm run cutover -- reconcile` e `npm run cutover -- compare`, com `BRSTEEL_CUTOVER_DATABASE_URL` e `BRSTEEL_CUTOVER_SOURCE_PROJECT`.

---

## Encerramento — revogar tudo

Ao terminar o ensaio, **no mesmo dia**:

```sql
-- Runtime
revoke brsteel_ops_writer from brsteel_ops_runtime;
alter role brsteel_ops_runtime nologin;
select pg_terminate_backend(pid) from pg_stat_activity where usename = 'brsteel_ops_runtime';
drop role brsteel_ops_runtime;

-- Importador do piloto, se provisionado
revoke brsteel_ops_importer from brsteel_pilot_importer;
alter role brsteel_pilot_importer nologin;
select pg_terminate_backend(pid) from pg_stat_activity where usename = 'brsteel_pilot_importer';

-- Deve devolver zero.
select count(*) from pg_stat_activity where usename in ('brsteel_ops_runtime', 'brsteel_pilot_importer');
```

Remova as variáveis do projeto de homologação, apague o snapshot e os relatórios dos diretórios privados, e restaure o deployment anterior de homologação.

---

## O que não fazer

- **Não aplicar estas migrations em `supabase/migrations`.** Aquela cadeia é do provedor de identidade OAuth; as operacionais ficam separadas justamente para não serem aplicadas por engano.
- **Não configurar `BRSTEEL_OPERATIONAL_DATABASE_URL` em produção.** A capacidade de trocar a fonte está publicada lá; o que a mantém desligada é `appConfig/operationalSource` não existir. Uma variável sozinha não troca nada, mas as duas juntas trocariam.
- **Não usar um snapshot antigo.** O schema mudou desde o piloto.
- **Não pular o `verify`.** Importar sem conferir de forma independente é a diferença entre ter uma cópia e achar que tem.
- **Não deixar os logins ativos além da janela.** O `valid until` é rede de segurança, não substituto da revogação.
