# Provisionamento para o ensaio do corte (etapa 5, Task 3)

O código do corte está pronto e testado: interruptor de manutenção, reconciliação, comparador e seletor trocável em runtime. O que falta é provisionamento, que envolve credenciais e por isso é seu.

**Nada aqui toca produção.** O destino é o Supabase `mlumbvxpaqfzpdjnvzxc` e o ambiente é a Vercel de homologação `br-steel-mcp-staging`. A aplicação de produção continua em Firestore o tempo todo — `appConfig/operationalSource` nem existe lá.

Guarde credenciais num arquivo privado fora do Git, com permissão `0600`. Nada deste roteiro deve ser colado em chat, issue ou PR.

**Estado em 15/09/2026, conferido direto no banco.** Os Passos 1 a 4 foram executados nessa data: as sete migrations aplicadas, os dois logins temporários provisionados com prazo até 17/09 23:00 UTC, cópia nova `ready=true` capturada às 23:46 UTC com 13.058 registros — 12.627 pedidos, 13.090 itens, 363 observações de estoque — `verify` aprovado, e as duas variáveis operacionais gravadas em homologação e ausentes de produção. Falta o Passo 5.

`brsteel_write.audit` e `brsteel_write.idempotency` seguem **vazias**: nenhuma gravação real jamais chegou ao PostgreSQL hospedado. Todo o teste de escrita da etapa 4 rodou em contêiner local descartável.

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

## Passo 1 — Conferir a cadeia de migrations

**As sete migrations operacionais já estão no destino.** Este passo pedia a aplicação de `20260912234410_operational_writer_role.sql` e `20260912235500_operational_native_run.sql`; as duas foram aplicadas antes de 13/09/2026. O `README.md` registrou isso na época, este roteiro não acompanhou. Reconferido em 15/09/2026: as sete devolvem o valor esperado.

**Não reaplique.** `operational_writer_role` falha com o schema já existente — e uma falha aqui pareceria defeito do destino, quando seria só ordem errada de leitura. A tabela completa das sete conferências está no `README.md`.

Confira estas três antes de seguir:

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

O papel `brsteel_ops_writer` nasce `NOLOGIN` de propósito. Crie um login temporário associado a ele, com senha aleatória e prazo curto.

> **Um ensaio anterior executou este passo e não completou o encerramento.** Em 15/09/2026 o papel `brsteel_ops_runtime` ainda existe no destino: `NOLOGIN`, `valid until 2026-09-14 20:00+00` (vencido), **ainda associado a `brsteel_ops_writer`** e sem sessão ativa. Ele não vem de migration nenhuma — só deste roteiro. Não é exposição aberta; é resíduo. Mas um `create role` puro falharia com *role already exists*, e por isso o bloco abaixo começa derrubando o que sobrou: o ensaio parte de estado conhecido, nunca de estado herdado.

```sql
-- Resíduo de ensaio anterior, se houver. As associações do papel caem junto com ele.
drop role if exists brsteel_ops_runtime;

-- Troque <SENHA> por um valor aleatório de 32+ caracteres e <PRAZO> por uma data futura
-- dentro da sua janela. NÃO reutilize '2026-09-14 20:00+00': é o exemplo da versão anterior
-- deste roteiro, e é literalmente o prazo que ficou no resíduo.
create role brsteel_ops_runtime login password '<SENHA>' valid until '<PRAZO>'
  nosuperuser nocreatedb nocreaterole noreplication nobypassrls inherit connection limit 4;
grant brsteel_ops_writer to brsteel_ops_runtime;
```

Se o `drop` reclamar de objetos dependentes, **pare e investigue**: significa que alguém concedeu privilégio direto ao papel em vez de passar pela associação, e o resíduo é maior do que este roteiro supõe.

Conferência — o login **não** pode ter mais do que o papel concede:

```sql
-- Deve devolver exatamente brsteel_ops_writer.
select granted.rolname from pg_auth_members m
join pg_roles granted on granted.oid = m.roleid
join pg_roles member on member.oid = m.member
where member.rolname = 'brsteel_ops_runtime';
```

> **Uma associação a mais é esperada no hospedado.** `postgres` é membro de `brsteel_ops_writer` com `admin_option`, porque no PostgreSQL 16+ quem cria um papel recebe administração sobre ele — e o `postgres` do Supabase, ao contrário do de um contêiner local, não é superusuário. Não é escalonamento do escritor. O teste de integração local afirma zero associações e passa, justamente porque lá o criador é superusuário e dispensa o registro: **é um comportamento que a suíte local não consegue observar.**

O papel escritor já cobre leitura **e** escrita do núcleo: conferido em 15/09/2026, tem `SELECT` nas **11** tabelas de `brsteel_ops`, na única de `brsteel_import` (`state`) e nas duas de `brsteel_write`, além de DML onde precisa. Não conceda nada além disso. (A versão anterior dizia "13 tabelas de `brsteel_ops`"; 13 é a soma dos schemas `brsteel_ops` e `brsteel_import`, como diz o README — não a contagem de um deles.)

**Nunca use o login `postgres` no runtime.** O código recusa: `operationalPoolConfig` rejeita `postgres` e `postgres.<projeto>` explicitamente.

---

## Passo 3 — Copiar os dados reais para o destino

**A cópia do piloto ainda está no destino.** O que foi encerrado no piloto foram os *acessos*, não os dados — reconferido em 15/09/2026 direto no banco: 12.538 pedidos, 12.999 itens, 361 observações de estoque, 54 insumos, 3 lotes, `ready=true`, capturada em 12/09 17:41 UTC e concluída às 17:54.

Mesmo assim é preciso uma exportação nova, por dois motivos: a cópia é de 12/09 e o schema mudou desde então. **Não reaproveite um JSON antigo** — ele não prova compatibilidade com o schema atual.

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

**Espere o import terminar antes de rodar o `verify`.** Executado em paralelo — outra aba, enquanto a carga ainda corre — ele encontra a cópia com `ready=false` e falha. A mensagem é sanitizada de propósito e não distingue esse caso de uma divergência real de dados, então parece defeito grave quando é só ordem. O import só libera a cópia depois de reconciliar ausências e reler conteúdos. Para saber onde a carga está, consulte o destino, não a mensagem:

```sql
select status, next_index, total_records, completed_at from brsteel_import.runs where status = 'loading';
select ready, completed_at from brsteel_import.state;
```

**O caminho do relatório é reservado com exclusividade.** Repetir um comando com um relatório que já existe devolve `EEXIST` antes de qualquer acesso ao banco — inclusive quando a tentativa anterior falhou. Use um caminho novo a cada execução; é a proteção que impede um erro de digitação de disparar uma importação.

Em 15/09/2026 as duas coisas aconteceram nesta ordem, e as duas pareceram falha de dados antes de serem lidas com atenção.

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

Os comandos de reconciliação e comparação são `npm run cutover -- reconcile` e `npm run cutover -- compare`. Contra o destino hospedado são **três** variáveis, e a URL é a do importador, não a do runtime:

| Variável | Valor |
| --- | --- |
| `BRSTEEL_CUTOVER_SOURCE_PROJECT` | `marketflow-9h4tg` |
| `BRSTEEL_CUTOVER_DATABASE_URL` | login `brsteel_pilot_importer` no pooler de sessão (5432), **sem query string** |
| `BRSTEEL_CUTOVER_CA_FILE` | caminho do certificado raiz |

A sequência inteira — `draining`, `blocked`, `reconcile`, `compare` e a devolução — está em `npm run cutover:rehearse -- --confirm`, com as mesmas três variáveis. Ele começa por um preflight que confere conexão, identidade, prontidão da cópia e o registro de manutenção **sem escrever nada**; só depois abre a janela. A restauração está num `finally` e cobre erro, divergência e Ctrl-C, mas não `SIGKILL` — nesse caso, apague `appConfig/coreWriteMode` para destravar.

O login é o do importador porque `assertHostedIdentity` exige `current_user` igual ao papel do piloto; o runtime seria recusado. A URL não aceita query string de propósito: o TLS vem do código, com CA e verificação de hostname, nunca de parâmetro que quem digita pode afrouxar.

> **Até 16/09/2026 o `reconcile` não funcionava contra o hospedado.** O script montava um `pg.Pool` cru, e `checkImportTarget` só reconhece pools criados pelas fábricas — um pool cru cai no ramo local e exige o banco `brsteel_ops_local`. O sintoma era `Local import target required`, e aparecia **depois** do núcleo já estar bloqueado, porque o `compare` não passa por esse caminho e por isso um ensaio seco passava limpo. Descoberto num ensaio real que manteve produção bloqueada por 46 segundos. Corrigido em `createCutoverPool`.

---

## Encerramento — revogar tudo

**O encerramento do ensaio anterior não foi concluído.** Em 15/09/2026, `brsteel_ops_runtime` ainda existia e `brsteel_pilot_importer` ainda estava associado a `brsteel_ops_importer` — ambos `NOLOGIN`, com prazo vencido e sem sessão ativa, mas de pé. Desligar o login é a metade que foi feita. A outra metade é esta lista, e ela precisa ser executada até o fim, com as conferências.

Ao terminar o ensaio, **no mesmo dia**:

```sql
-- Runtime
revoke brsteel_ops_writer from brsteel_ops_runtime;
alter role brsteel_ops_runtime nologin;
select pg_terminate_backend(pid) from pg_stat_activity where usename = 'brsteel_ops_runtime';
drop role brsteel_ops_runtime;

-- Importador do piloto, se provisionado. O noinherit devolve o papel ao estado da migration,
-- caso o provisionamento tenha alterado rolinherit para fazer a herança valer.
revoke brsteel_ops_importer from brsteel_pilot_importer;
alter role brsteel_pilot_importer nologin noinherit;
select pg_terminate_backend(pid) from pg_stat_activity where usename = 'brsteel_pilot_importer';

-- Deve devolver zero.
select count(*) from pg_stat_activity where usename in ('brsteel_ops_runtime', 'brsteel_pilot_importer');

-- Deve devolver zero: o papel de runtime não pode continuar de pé.
select count(*) from pg_roles where rolname = 'brsteel_ops_runtime';

-- Deve devolver zero: a associação do importador de piloto tem de sair.
select count(*) from pg_auth_members m
join pg_roles granted on granted.oid = m.roleid
join pg_roles member on member.oid = m.member
where member.rolname = 'brsteel_pilot_importer' and granted.rolname = 'brsteel_ops_importer';
```

Sessão zerada não é encerramento. Enquanto o papel existir e a associação estiver de pé, o que separa o destino de um acesso ativo é só uma senha e um `valid until` — dois comandos de distância.

Remova as variáveis do projeto de homologação, apague o snapshot e os relatórios dos diretórios privados, e restaure o deployment anterior de homologação.

---

## O que não fazer

- **Não aplicar estas migrations em `supabase/migrations`.** Aquela cadeia é do provedor de identidade OAuth; as operacionais ficam separadas justamente para não serem aplicadas por engano.
- **Não configurar `BRSTEEL_OPERATIONAL_DATABASE_URL` em produção.** A capacidade de trocar a fonte está publicada lá; o que a mantém desligada é `appConfig/operationalSource` não existir. Uma variável sozinha não troca nada, mas as duas juntas trocariam.
- **Não reaplicar as migrations operacionais.** As sete já estão no destino desde 12/09; reaplicar `operational_writer_role` falha com o schema existente.
- **Não usar um snapshot antigo.** O schema mudou desde o piloto.
- **Não pular o `verify`.** Importar sem conferir de forma independente é a diferença entre ter uma cópia e achar que tem.
- **Não deixar os logins ativos além da janela.** O `valid until` é rede de segurança, não substituto da revogação.
