# Provisionamento para o ensaio do corte (etapa 5, Task 3)

> **Projeto atual: `mmewkphsrnttkzvpyddv`** (organização BR Steel), desde 11/11/2026. O que está datado de setembro neste documento se refere ao projeto antigo `mlumbvxpaqfzpdjnvzxc`. As oito migrations já estão no projeto atual. Uma cópia dos dados foi carregada em 11/11/2026 (ver Passo 3), e a homologação passou a ler dessa cópia no mesmo dia (ver "Troca da fonte em homologação"). O host do pooler passou a ser `aws-1-sa-east-1.pooler.supabase.com`. Ver a [migração do Supabase](../../docs/migracao-supabase-2026-11.md).

> **Histórico de estoque e demanda semanal (11/11/2026).** O log de observações de estoque e a série semanal de demanda por SKU passaram a existir em PostgreSQL com o PR [#34](https://github.com/acassiusalves/br-steel/pull/34), em produção desde 11/11/2026: a migration [`20261111120000_operational_history.sql`](migrations/20261111120000_operational_history.sql) cria `stock_observation_log` e `sku_weekly_demand`, e o export, o import, o `verify`, a reconciliação e o comparador cobrem as duas. A migration foi aplicada em `mmewkphsrnttkzvpyddv` em 11/11/2026. A carga do mesmo dia copiou o histórico: 3.706 observações de estoque e 208 semanas de demanda.

O código do corte está pronto e testado: interruptor de manutenção, reconciliação, comparador e seletor trocável em runtime. O que falta é provisionamento, que envolve credenciais e por isso é seu.

**Nada aqui toca produção.** O destino é o Supabase `mmewkphsrnttkzvpyddv` e o ambiente é a Vercel de homologação `br-steel-mcp-staging`. A aplicação de produção continua em Firestore o tempo todo — `appConfig/operationalSource` nem existe lá.

Guarde credenciais num arquivo privado fora do Git, com permissão `0600`. Nada deste roteiro deve ser colado em chat, issue ou PR.

**Estado em 15/09/2026, conferido direto no banco.** Os Passos 1 a 4 foram executados nessa data: as sete migrations aplicadas, os dois logins temporários provisionados com prazo até 17/09 23:00 UTC, cópia nova `ready=true` capturada às 23:46 UTC com 13.058 registros — 12.627 pedidos, 13.090 itens, 363 observações de estoque — `verify` aprovado, e as duas variáveis operacionais gravadas em homologação e ausentes de produção. Falta o Passo 5.

`brsteel_write.audit` e `brsteel_write.idempotency` seguem **vazias**: nenhuma gravação real jamais chegou ao PostgreSQL hospedado. Todo o teste de escrita da etapa 4 rodou em contêiner local descartável.

---

## O que você precisa em mãos

| Item | Onde |
| --- | --- |
| Acesso de administrador ao Supabase `mmewkphsrnttkzvpyddv` | SQL Editor do painel |
| Certificado raiz TLS do projeto | Painel → Settings → Database → SSL Configuration |
| Credencial de serviço do Firebase `marketflow-9h4tg` | para exportar os dados reais |
| Acesso ao projeto Vercel `br-steel-mcp-staging` | `prj_YD3ATzBPFQo4bD1ZlojrDTigUZp8` |
| Uma janela de ~1 hora | o ensaio mede tempos; interrupções distorcem a medição |

---

## Passo 1 — Conferir a cadeia de migrations

**A cadeia tem oito migrations, e as oito estão no destino.** A oitava, `20261111120000_operational_history.sql` (cria `stock_observation_log` e `sku_weekly_demand`), foi aplicada em 11/11/2026 e conferida com a consulta `operational_history` da tabela do `README.md`, que devolveu 2. Repita a conferência antes de seguir. **A migration precisa estar aplicada antes de habilitar o piloto MCP em PostgreSQL ou de trocar `operationalSource`: o leitor de demanda em PostgreSQL e os webhooks de estoque em SQL passam a depender das duas tabelas novas.** O ensaio (`scripts/operational-cutover-rehearsal.ts`) recusa abrir a janela se alguma tabela da cópia estiver ausente.

**As sete primeiras migrations operacionais já estão no destino.** Este passo pedia a aplicação de `20260912234410_operational_writer_role.sql` e `20260912235500_operational_native_run.sql`; as duas foram aplicadas antes de 13/09/2026. O `README.md` registrou isso na época, este roteiro não acompanhou. Reconferido em 15/09/2026: as sete devolvem o valor esperado.

**Não reaplique.** `operational_writer_role` falha com o schema já existente — e uma falha aqui pareceria defeito do destino, quando seria só ordem errada de leitura. A oitava também falha se reaplicada, porque as tabelas já existem; como ela roda numa transação, a falha não deixa nada pela metade. A tabela completa das oito conferências está no `README.md`.

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
grant brsteel_ops_writer to brsteel_ops_runtime with inherit true;

-- O pooler descarta o statement_timeout que o código envia ao conectar. Fixe o valor no papel.
alter role brsteel_ops_runtime set statement_timeout = '30s';
```

**Provisionado em 11/11/2026 no projeto atual, com prazo até 18/11/2026 23:00 UTC.** A senha foi gerada localmente, e o banco recebeu só o verificador SCRAM-SHA-256. O `create role` aceita o verificador no lugar da senha, e assim o texto da senha não passa pelo servidor nem pelos logs. A conferência abaixo devolveu só `brsteel_ops_writer`, com herança, e o papel não tem privilégio direto em tabela nenhuma.

**O pooler ignora o `statement_timeout` de inicialização.** O pool do runtime pede 30 s ao conectar, mas o Supavisor em modo sessão descarta esse parâmetro, e a sessão fica com os 2 minutos do banco. Os papéis do piloto já fixam o valor no próprio papel, e o `alter role ... set` acima faz o mesmo no runtime. O ajuste só vale para conexões novas, e o Supavisor reaproveita as ociosas. Depois de alterá-lo, encerre as sessões do papel com `pg_terminate_backend` e confira `select current_setting('statement_timeout')` numa conexão nova.

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

**A primeira carga no projeto atual partiu do zero.** As cópias do piloto (12/09 e 15/09) ficaram no projeto antigo `mlumbvxpaqfzpdjnvzxc` e não foram trazidas: a fonte de verdade é o Firestore. Depois da primeira carga, toda importação nova **reconcilia sobre a cópia existente** em vez de carregar do zero, e a guarda de colisão entre linha nativa e documento de snapshot protege esse caminho.

**Carga de 11/11/2026, conferida.** A exportação foi capturada às 22:21 UTC, com 18.998 registros. O import terminou às 22:37 UTC, depois de 12 minutos pelo pooler em modo sessão, e o `verify` passou. A cópia tem `ready=true` e contém:
- 14.603 pedidos e 15.166 itens;
- 413 registros de estoque atual, 3.706 observações de estoque e 208 semanas de demanda;
- 54 insumos, 1 movimentação, 3 lotes, 7 itens de lote e 3 colunas de produção.

O snapshot e os relatórios ficaram fora do Git. Produção e homologação continuam lendo o Firestore, então a cópia envelhece. Antes do ensaio e antes do corte, uma importação nova reconcilia sobre ela.

Toda carga sai de uma exportação nova. **Não reaproveite um JSON antigo:** ele não prova compatibilidade com o schema atual.

**O login de importação já existe, sem permissão de entrar.** A migration `operational_pilot_roles` cria `brsteel_pilot_importer` como `NOLOGIN`, associado a `brsteel_ops_importer`, com limite de duas conexões. O importador confere que a sessão é exatamente esse papel e assume `brsteel_ops_importer` com `set local role`. Não crie outro papel. Habilite o login só durante a carga, com senha aleatória e prazo curto:

```sql
alter role brsteel_pilot_importer login password '<SENHA>' valid until '<PRAZO>';
```

Ao terminar, mesmo se a carga falhar:

```sql
alter role brsteel_pilot_importer nologin password null valid until 'epoch';
select pg_terminate_backend(pid) from pg_stat_activity where usename = 'brsteel_pilot_importer';
```

O `nologin` não derruba sessões abertas. Depois da carga de 11/11, o Supavisor manteve uma conexão do importador ociosa, e foi preciso encerrá-la. Confira que esta consulta devolve zero: `select count(*) from pg_stat_activity where usename like 'brsteel_pilot%'`.

**O certificado raiz é o "Supabase Root 2021 CA".** Baixe-o pelo painel (Settings → Database → SSL Configuration) ou de `https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt`. Confira a impressão SHA-256: `80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA`. O pooler apresenta a cadeia completa, mas a raiz que vem do próprio servidor não serve de prova.

Prepare um arquivo privado de ambiente (`0600`, fora do Git):

```
BRSTEEL_PG_SOURCE_PROJECT=marketflow-9h4tg
BRSTEEL_PG_PILOT_IMPORTER_URL=postgres://brsteel_pilot_importer.mmewkphsrnttkzvpyddv:<SENHA>@aws-1-sa-east-1.pooler.supabase.com:5432/postgres
BRSTEEL_PG_CA_FILE=/caminho/privado/supabase-ca.crt
GOOGLE_APPLICATION_CREDENTIALS=/caminho/privado/marketflow-service-account.json
```

A exportação lê o Firestore com as credenciais padrão do Google. Sem `GOOGLE_APPLICATION_CREDENTIALS`, ela usa o login de `gcloud auth application-default login` de uma conta com leitura em `marketflow-9h4tg`. Antes de exportar, confira que `FIRESTORE_EMULATOR_HOST` não está definido: com ele, a exportação leria o emulador.

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
| `BRSTEEL_OPERATIONAL_DATABASE_URL` | `postgres://brsteel_ops_runtime.mmewkphsrnttkzvpyddv:<SENHA>@aws-1-sa-east-1.pooler.supabase.com:5432/postgres` |
| `BRSTEEL_OPERATIONAL_CA` | conteúdo do certificado raiz, não o caminho |

Use **modo sessão (5432)** também aqui no ensaio. O modo transacional (6543) é o que a especificação recomenda para runtime serverless, mas ele rejeita alguns parâmetros de inicialização — entre eles o `statement_timeout` que o pool define. Validar o modo transacional é um item do ensaio, não uma premissa dele.

Confira que as variáveis **não** vazaram para produção antes de seguir.

**Gravadas em 11/11/2026.** As duas variáveis estão no destino Production do projeto `br-steel-mcp-staging`, como Secret, e não existem no projeto `br-steel`. A homologação foi republicada a partir da `main` (`53fc83a`) com o manifesto de homologação: `dpl_3PgESRiUst42E8poCjHssDkYTxhT`. Para voltar, a publicação anterior é `dpl_ErRwzBbGXTmqVHfJ33ajYVfnYay8`.

---

## Troca da fonte em homologação

A chave mora no Firestore de cada ambiente. A homologação usa o Firebase `brsteel-mcp-staging`, separado do `marketflow-9h4tg` da produção, e por isso gravar `appConfig/operationalSource` nele não alcança a produção. A gravação usa o Admin SDK com as credenciais padrão do Google: o login de `gcloud auth application-default login` de uma conta com acesso ao projeto, sem `FIRESTORE_EMULATOR_HOST`.

- Para ler do PostgreSQL, grave `appConfig/operationalSource = { source: "postgres" }`.
- Para voltar ao Firestore, apague o documento. Ausente vale `firestore`.

A troca vale em até 5 s, o tempo do cache do seletor, sem republicar. As variáveis do Passo 4 precisam estar publicadas antes: com a chave em `postgres` e sem conexão configurada, o núcleo responde 503, sem cair para o Firestore.

**Feita em 12/11/2026 às 00:25 UTC (21:25 de 11/11 em Brasília).** Todas as consultas pelo conector da homologação no Claude responderam com fonte `postgres`:
- `resumir_vendas` de 05/11 a 11/11 devolveu 289 pedidos. A produção mostrava 295 no mesmo instante. A diferença são os pedidos que entraram depois da exportação das 22:21 UTC, e o período anterior bate exatamente.
- `consultar_estoque_produtos`, `consultar_demanda_producao`, `consultar_historico_sku` e `listar_lotes_producao` devolveram dados da cópia. A demanda veio com estoque e limites mínimo e máximo da cópia.
- `listar_insumos` devolveu a primeira página vazia, com o mesmo aviso e o mesmo cursor da produção. Os dois adaptadores se comportam igual.

No banco, o runtime abriu 4 conexões pelo Supavisor, e `brsteel_write.audit` e `brsteel_write.idempotency` continuaram vazias. A Vercel não registrou erro de execução na homologação.

O que observar daqui em diante:
- **O Supavisor mantém as conexões ociosas até o limite do papel.** Depois das consultas, as 4 conexões permitidas ficaram abertas no pooler. Com o tráfego de uma pessoa, isso não tem efeito. Antes de repetir o desenho em produção, meça a concorrência: o `connection limit` vale para o papel inteiro, somando todas as instâncias da Vercel.
- **A cópia não acompanha o Firestore.** A homologação mostra os dados do instante da exportação, e a defasagem cresce cerca de 3 registros por hora. Para atualizar, rode uma importação nova (Passo 3), que reconcilia sobre a cópia.
- **Gravar pela homologação muda a natureza da cópia.** Nenhuma gravação oficial chegou ainda ao PostgreSQL. Uma gravação pelo site da homologação seria a primeira, e a partir dela a cópia deixaria de ser só reflexo do Firestore. Isso corresponde ao Passo 5 do plano da etapa 5 (retorno depois de gravações oficiais) e deve acontecer de propósito.
- **A tela de produção do site lia `supplies` direto do Firestore** (ver os bloqueadores abaixo). O Firestore da homologação não tem essa coleção, então, na publicação de 11/11, os limites mínimo e máximo dessa tela aparecem vazios. A correção já está no código e chega à homologação na próxima publicação. O MCP não foi afetado, porque já usava o repositório trocável.
- **A homologação passou a mostrar dados reais.** A cópia tem pedidos e clientes reais. O acesso continua restrito aos usuários cadastrados no Firebase da homologação e, no MCP, à lista `MCP_ALLOWED_USER_IDS`.

---

## Retorno PostgreSQL → Firestore

O retorno devolve ao Firestore um ambiente que está servindo do PostgreSQL. Ele espelha a cópia no Firestore do próprio ambiente e, com divergência zero, apaga `appConfig/operationalSource`. O código está em `src/server/migration/operational-return.ts` e `operational-return-run.ts`, e os testes em `tests/postgres/operational-return.integration.ts`. **A ferramenta ainda não foi ensaiada contra um ambiente hospedado.**

**O que a ferramenta faz.** Compara cada coleção do núcleo nos dois lados, por id:
- o que está no PostgreSQL e falta no Firestore é criado;
- o que tem conteúdo diferente é regravado com o documento inteiro, sem merge;
- o que está no Firestore e não existe mais no PostgreSQL é apagado. Os adaptadores PostgreSQL apagam linhas de verdade (lotes, colunas, comentários, insumos e códigos), e só a comparação do estado inteiro enxerga isso.

Em `operationsMetadata`, só entram os contadores `production-lots-AAAA`, como no export. Os outros documentos da coleção nunca são tocados. Dois campos voltam como `Timestamp`, desde que a string seja a que o export produziria e que o Firestore consiga guardar sem perder precisão: o `expiresAt` das observações de estoque, porque a política de TTL ignora strings, e, numa atualização, todo campo de primeiro nível que já era `Timestamp` no documento substituído. As gravações saem em lotes de até 400 operações e até 4 MB.

**O que fica de fora:**
- **Demanda semanal.** `skuWeeklyDemand` não volta. O checkpoint do Firestore ficou no valor de antes do corte, e o rollup recalcula a série a partir de `salesOrders`.
- **Cópia pronta para um novo corte.** As linhas nativas continuam na cópia, com os mesmos ids que o retorno criou no Firestore. Um novo corte sobre essa cópia recusaria com "Native row collision" (ver os bloqueadores abaixo).
- **Integrações.** Os efeitos que o ambiente já enviou a integrações enquanto servia do PostgreSQL não são desfeitos.

**Variáveis.** O login é o do importador, como no `reconcile` e no `compare`:

| Variável | Valor |
| --- | --- |
| `BRSTEEL_RETURN_TARGET_PROJECT` | o Firebase do ambiente que volta; na homologação, `brsteel-mcp-staging` |
| `BRSTEEL_CUTOVER_DATABASE_URL` | login `brsteel_pilot_importer` no pooler de sessão (5432), **sem query string** |
| `BRSTEEL_CUTOVER_CA_FILE` | caminho do certificado raiz |

O projeto de destino é obrigatório e não tem valor padrão. A gravação usa as credenciais padrão do Google (o login de `gcloud auth application-default login` de uma conta com acesso ao projeto), sem `FIRESTORE_EMULATOR_HOST`. Os comandos imprimem o projeto de destino e a origem da cópia (`brsteel_import.state.source_project`). Quando os dois diferem, imprimem "destino diferente da origem da cópia: ensaio". Na homologação, isso é o esperado: a cópia veio de `marketflow-9h4tg`.

**Comandos:**
- `npm run cutover:return-tool -- plan` mostra o que o retorno mudaria, sem gravar: contagens por coleção e até 50 mudanças, com coleção, id e tipo.
- `npm run cutover:return-tool -- verify` faz a mesma comparação e termina com código 1 se houver divergência.
- `npm run cutover:return-tool -- apply` grava, sob as duas travas, e não mexe nos registros de `appConfig`. Bloquear o núcleo e trocar a fonte ficam com quem chama.
- `npm run cutover:return -- --confirm` faz a volta inteira. Sem `--confirm`, recusa.

**As duas travas.** O `apply` lê os dois registros do próprio Firestore de destino, sem cache, e recusa:
- se `appConfig/operationalSource` não for `postgres`. Assim a ferramenta nunca grava num Firestore que ainda é a fonte viva;
- se `appConfig/coreWriteMode` não for `blocked`. Com o núcleo aberto, a cópia mudaria durante o espelhamento.

**A sequência.** `npm run cutover:return -- --confirm` começa por um pré-voo que não grava nada. Ele confere a identidade no PostgreSQL (o login da sessão, sem superusuário), a fonte `postgres`, a ausência de `appConfig/coreWriteMode` e a cópia com `ready=true`, e imprime o plano. Depois:

1. grava `draining` e espera 20 s pelas chamadas em trânsito;
2. grava `blocked` e espera 10 s;
3. roda o `apply`;
4. roda o `verify`;
5. com divergência zero, apaga `appConfig/operationalSource` e espera 10 s com o núcleo ainda bloqueado, porque o cache do seletor é de 5 s;
6. apaga `appConfig/coreWriteMode`, e o núcleo volta a aceitar escritas.

A janela dura 40 s mais o tempo do `apply` e do `verify`. Os dois leem as duas bases inteiras, e o primeiro `apply` de um ambiente também grava a cópia inteira. Meça esse tempo no ensaio. A reabertura está num `finally` e cobre erro, divergência e Ctrl-C, mas não `SIGKILL`. Nesse caso, apague `appConfig/coreWriteMode` à mão.

**Com divergência ou erro, a fonte não muda.** O comando reabre o núcleo, e o ambiente continua servindo do PostgreSQL, sem perda. A saída lista até 50 divergências, com coleção, id e tipo, e termina com código 1. Para resolver:
- rode `npm run cutover:return-tool -- plan` para ver o estado atual;
- repita `npm run cutover:return -- --confirm`. Um retorno interrompido se resolve repetindo: depois de um `apply` completo, o `plan` devolve zero mudanças;
- se a mesma divergência voltar a cada execução, leia o documento citado nos dois lados antes de repetir. Ela indica um valor que o Firestore não guarda igual ao PostgreSQL.

**Consequências para o ensaio na homologação:**
- **O primeiro retorno grava uma cópia completa no Firebase da homologação.** O `apply` cria em `brsteel-mcp-staging` cerca de 18,8 mil documentos (pedidos, itens, estoque, observações, insumos e lotes) e apaga, nessas coleções, o que não estiver na cópia. São dados reais de clientes, como os da cópia. Depois do retorno, a homologação lê esses documentos do próprio Firestore.
- **Uma cópia alterada pelo ensaio precisa ser recarregada do zero antes do corte da produção.** As gravações pela homologação criam linhas nativas e alteram linhas importadas. Uma importação nova reconcilia sobre a cópia, mas preserva as linhas nativas, e o corte partiria de uma cópia que não é reflexo do `marketflow-9h4tg`. Antes do corte, a carga parte de uma exportação nova e de uma cópia vazia (Passo 3).

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

Antes de remover as variáveis, apague `appConfig/operationalSource` do Firestore da homologação. Sem a chave, a homologação volta a ler o próprio Firestore. Com a chave em `postgres` e sem as variáveis, ela responde 503. Depois remova as variáveis do projeto de homologação, apague o snapshot e os relatórios dos diretórios privados, e restaure o deployment anterior de homologação.

---

## Bloqueadores conhecidos do corte real

Levantamento de 16/09/2026. Nem toda leitura de dados do núcleo passa pelos repositórios trocáveis. Uma leitura direta em `adminDb.collection(...)` ignora `operationalSource` e, depois do corte, continua consultando uma coleção do Firestore que parou de crescer — **sem erro, com números cada vez mais defasados.**

As gravações estão corretas: `saveSalesOrdersOptimized` delega a `salesIngestRepository.upsertOrders`, e o webhook do Bling usa o repositório para observação de estoque e exclusão lógica. O problema é só de leitura.

| Onde | Chamado por | Efeito após o corte | Situação |
| --- | --- | --- | --- |
| `firestore-sku-weekly-demand.ts` `rollUpWeek` | cron semanal | demanda silenciosamente errada; alimenta `consultar_historico_sku` e a tela de produção | **corrigido** |
| `firestore-production-demand.ts` `adminDb.collection('supplies').get()` | tela de produção (`readFirestoreProductionDemand`) | os limites mínimo/máximo de estoque (`estoqueMinimo`/`estoqueMaximo`) passam a vir de uma coleção que não é mais atualizada: congelam sem erro | **corrigido** |
| `operations/stock.ts` (observações de webhook) | tela de estoque do site | o caminho vivo perde observações novas; o MCP não é afetado, usa o caminho armazenado | **corrigido** |
| `actions.ts` `deleteAllSalesOrders` | `api-settings` | **destrutivo**: apagaria a base que não está mais em uso | **corrigido** |
| `actions.ts` `countImportedOrders` | `api-settings` | contagem congelada na tela | **corrigido** |
| `actions.ts` `clearStockUpdates` | sem chamador encontrado | limparia a base errada | **corrigido** |
| `order-service.ts` `getLastImportedOrderDate` | `actions.ts` | importação manual recomeça de data antiga | **corrigido** |
| `order-service.ts` `getImportedOrderIdsWithDetails` | `actions.ts` | importação manual reimporta o que já existe | **corrigido** |
| `order-service.ts` `orderExists` | `actions.ts` | detecção de duplicata deixa de funcionar | **corrigido** |
| `order-service.ts` `getExistingOrderIds` | sem chamador encontrado | possivelmente código morto | **corrigido** |

Os itens originais foram resolvidos em 16/09/2026. A leitura direta de `supplies`, acrescentada à lista e corrigida em 11/11/2026, passou a usar `supplyLimitsRepository.readLimits()`, que é trocável. Esta leitura não reaproveita a listagem de insumos, porque a coleção também guarda limites de produtos sem `nome`, e a listagem descarta esses registros. Os dois adaptadores usam a mesma chave (`codigo` ou o id do documento) e o mesmo desempate (vence o maior id). O SQL é o mesmo da demanda do MCP. A equivalência está em `tests/postgres/operational-readers.integration.ts`. Dos itens originais, dois eram código morto e foram apagados. Dois são ferramentas administrativas destrutivas sem equivalente na outra fonte: passaram a recusar por `requireFirestoreSource`, porque apagar a base que ninguém mais usa enquanto o operador vê "pronto" é pior que não apagar. Os outros quatro ganharam roteamento — três métodos novos em `SalesReadRepository` e o uso de `stockReadRepository.snapshot()` no caminho vivo do estoque.

O teste de equivalência entre os adaptadores pagou-se na hora: o SQL filtrava exclusões lógicas enquanto o Firestore conta todo documento, e a mesma tela mostraria totais diferentes conforme a fonte.

**Histórico de estoque e demanda semanal.** Em 11/11/2026 o pré-requisito de dados do corte — o log append-only de estoque no destino — foi atendido no código: `applyStockObservation` do caminho PostgreSQL grava em `stock_observation_log` com a mesma regra do log do Firestore, e a série semanal de demanda tem repositório próprio em PostgreSQL (`skuWeeklyDemandRepository`), usado pelo cron `/api/cron/sku-weekly-rollup`, por `consultar_historico_sku` e pela tela de produção (`readFirestoreProductionDemand` lê as semanas fechadas por `skuWeeklyDemandRepository.readWeeklyHistory`, não mais direto do módulo do Firestore; teste em `tests/operations/production-demand-source.test.ts`). O checkpoint do rollup é derivado das linhas vivas; o documento `appConfig/skuWeeklyDemandRollup` não é copiado. O `scripts/backfill-sku-weekly-demand.ts` continua só no Firestore, de propósito: roda antes do corte. A migration `20261111120000_operational_history.sql` foi aplicada no projeto hospedado em 11/11/2026; falta copiar o histórico na reconciliação.

**Retorno PostgreSQL → Firestore dos dados nativos novos.** O retorno (Passo 5 do plano da etapa 5) precisa tratar o que só existe no PostgreSQL depois do corte:

- **Log de estoque.** As linhas nativas de `stock_observation_log` (ids UUID) existem só no PostgreSQL. Têm de ser copiadas de volta para `stockObservations`, com `expiresAt` convertido em `Timestamp` do Firestore: a política de TTL ignora strings e as observações nunca expirariam.
- **Novo corte depois do retorno.** Manter os ids na volta transforma um novo corte numa recusa explícita ("Native row collision") em vez de duplicatas silenciosas. Antes de um novo corte, as linhas nativas de `stock_observation_log` (copiadas de volta) e de `sku_weekly_demand` (recalculadas no Firestore) precisam ser resolvidas explicitamente — por exemplo, removidas da cópia. Sem isso, espere colisão (mesmo id) ou duplicata (`CHAPA_10~hash` ao lado de `CHAPA/10`).
- **Demanda semanal.** A série se cura no retorno por recomputação: o checkpoint do Firestore fica no valor de antes do corte e o rollup do Firestore recalcula as semanas a partir de `salesOrders`. Este é o caminho reverso pretendido para esta série; não há cópia de volta.

**Nada disto aparece num ensaio.** O ensaio prova que a cópia fica idêntica no instante do bloqueio; ele não exercita a aplicação depois do corte. O que revelaria estes casos é a troca da fonte em homologação, com a aplicação servindo do PostgreSQL. A troca foi feita em 11/11/2026, e as leituras do MCP responderam da cópia. Falta exercitar as telas do site. A ferramenta do retorno existe (ver "Retorno PostgreSQL → Firestore"); falta o ensaio.

---

## O que não fazer

- **Não aplicar estas migrations em `supabase/migrations`.** Aquela cadeia é do provedor de identidade OAuth; as operacionais ficam separadas justamente para não serem aplicadas por engano.
- **Não configurar `BRSTEEL_OPERATIONAL_DATABASE_URL` em produção.** A capacidade de trocar a fonte está publicada lá; o que a mantém desligada é `appConfig/operationalSource` não existir. Uma variável sozinha não troca nada, mas as duas juntas trocariam.
- **Não reaplicar as migrations operacionais.** As oito já estão no destino; reaplicar `operational_writer_role` ou `operational_history` falha com o schema existente.
- **Não usar um snapshot antigo.** O schema mudou desde o piloto.
- **Não pular o `verify`.** Importar sem conferir de forma independente é a diferença entre ter uma cópia e achar que tem.
- **Não deixar os logins ativos além da janela.** O `valid until` é rede de segurança, não substituto da revogação.
