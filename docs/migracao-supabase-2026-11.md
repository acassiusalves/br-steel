# Migração do Supabase para a organização BR Steel

Em 11/11/2026, o banco foi preparado para sair do projeto `mlumbvxpaqfzpdjnvzxc` ("BR Stell MCP / Sistema", organização Lunneta Ads) e ir para o projeto `mmewkphsrnttkzvpyddv` ("Brsteel", organização da Barbosa). As duas organizações estão no plano Pro, ambas em `sa-east-1`. A decisão foi tomada na reunião de 10/11/2026: o banco precisa ficar em conta da empresa, e o Firebase será abandonado.

## O que mudou de lugar

O projeto antigo guardava duas coisas.

| Parte | No projeto antigo | No projeto novo |
| --- | --- | --- |
| Provedor OAuth do MCP | Em uso por produção e homologação: 2 usuários, sessões renovadas diariamente | Recriado: funções, ACL e configuração do Auth idênticas |
| Banco operacional | Cadeia de 7 migrations e uma cópia do Firestore parada em 16/09/2026; nenhuma gravação oficial (`brsteel_write` vazio) | Cadeia recriada; carregada em 11/11/2026 de uma exportação nova do Firestore; lida pela homologação desde 11/11/2026, enquanto a produção segue no Firestore |

**Nenhum dado foi copiado do projeto antigo.** A cópia operacional antiga está defasada, e a fonte de verdade continua no Firestore. A carga do novo projeto deve sair de uma exportação nova, como já exigia o [roteiro do corte](../supabase/operational/cutover-rehearsal.md). Os usuários e clientes OAuth também não foram copiados: a ponte recria a identidade Supabase no primeiro acesso (`ensureIdentity`), e os clientes nascem de novo pelo registro dinâmico quando o Claude reconecta.

## O que foi feito

1. As 7 migrations de [`supabase/operational/migrations/`](../supabase/operational/migrations/) foram aplicadas em ordem com `supabase db query --linked`. Como no SQL Editor, esse caminho **não escreve** em `supabase_migrations.schema_migrations`. A conferência se faz pelos objetos, com a tabela do [README operacional](../supabase/operational/README.md).
2. As 3 migrations do OAuth hospedado foram aplicadas na ordem de origem: [audiência de homologação](../supabase/hosted/migrations/20260911214830_mcp_staging_oauth_audience.sql), depois [audiência de produção](../supabase/hosted/production/migrations/20260912003415_mcp_production_oauth_audience.sql), depois [roteamento de consentimento](../supabase/hosted/consent-routing/migrations/20260912214850_mcp_consent_resource.sql). O [teste CLI do hook](../supabase/hosted/production/tests/mcp_access_token_hook_cli.sql) passou. O `verify.sql` do consentimento insere fixtures e serve só para banco local; não foi executado no hospedado.
3. Pela API de gestão, a configuração do Auth do projeto antigo foi comparada com a do novo, campo a campo. Os 10 campos diferentes foram igualados: `disable_signup`, hook de access token (habilitado, `pg-functions://postgres/private/mcp_access_token_hook`), `jwt_exp` 900, servidor OAuth habilitado com registro dinâmico e caminho `/oauth/consent`, `security_refresh_token_reuse_interval` 0, Site URL `https://br-steel.vercel.app` e os dois retornos `/oauth/consent` de produção e homologação. A única diferença restante é `custom_oauth_max_providers`, que é limite da plataforma e não configuração.
4. Código e exemplos de ambiente passaram a fixar o novo projeto. O validador de homologação recusa o projeto antigo.

## Conferência

Os hashes, calculados nos dois projetos com a mesma consulta, saíram idênticos para:

- definição, dono, ACL, `search_path` e `SECURITY DEFINER` das funções em `public`, `private` e nos schemas `brsteel_*`;
- dono e ACL dos schemas `private`, `brsteel_ops`, `brsteel_import` e `brsteel_write`;
- ACL e RLS das 15 tabelas operacionais;
- políticas RLS.

Os papéis `brsteel_*` têm os mesmos atributos. O antigo ainda tem o resíduo `brsteel_backup_probe` (`NOLOGIN`, vencido), que não foi recriado. A descoberta OAuth do novo projeto responde com o emissor `https://mmewkphsrnttkzvpyddv.supabase.co/auth/v1`, e as chaves de assinatura são ES256, como no antigo.

## Diferenças que afetam conexões

- **O pooler mudou de host.** O projeto novo usa `aws-1-sa-east-1.pooler.supabase.com`, e o antigo usava `aws-0-sa-east-1`. As guardas de conexão em [`operational-hosted.ts`](../src/server/migration/operational-hosted.ts) e [`operational-backup.mjs`](../scripts/lib/operational-backup.mjs) foram atualizadas. Roteiros datados que citam `aws-0` se referem ao projeto antigo.
- **A CLI precisa de um diretório de trabalho isolado.** O [`supabase/config.toml`](../supabase/config.toml) deste repositório é do provedor OAuth local e exige chaves de assinatura locais. Para consultar um projeto hospedado, use `--workdir` apontando para um diretório vazio fora do repositório. O diretório guarda o projeto vinculado em `supabase/.temp/linked-project.json`, e um diretório vinculado antes ao projeto antigo continua apontando para ele. Antes de gravar, confira esse arquivo e confirme o destino com uma consulta de leitura, por exemplo `select version()`: 17.11 no novo, 17.6 no antigo.
- **O PostgreSQL do novo projeto é 17.11.** O antigo é 17.6.

## Troca nos ambientes

As duas trocas foram feitas em 11/11/2026. A troca muda o emissor dos tokens. Por isso, **toda conexão do conector no Claude precisa ser refeita** depois de cada publicação: o Claude guarda o servidor de autorização e o cliente registrado no projeto antigo.

### Homologação: trocada em 11/11/2026

- As quatro variáveis do projeto Vercel `br-steel-mcp-staging` (`BRSTEEL_STAGING_SUPABASE_PROJECT_REF`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`) apontam para o projeto novo. Ficaram gravadas como Secret.
- A publicação `dpl_ErRwzBbGXTmqVHfJ33ajYVfnYay8` saiu desta branch com o manifesto [`vercel.mcp-staging.json`](../config/vercel.mcp-staging.json) materializado na raiz. O `vercel.json` do checkout foi restaurado.
- **O Site URL do projeto novo aponta para a homologação durante a transição.** A tela de consentimento abre no Site URL, e cada aplicação só atende solicitações do próprio recurso, consultando o próprio projeto Supabase ([`consent-routing.ts`](../src/server/oauth/consent-routing.ts)). Com o Site URL em produção, uma autorização da homologação cairia na produção, que ainda consulta o projeto antigo, e seria recusada.
- Conferido: o MCP sem token responde 401; os metadados do recurso anunciam o emissor novo; o login responde 200; quatro crons sem credencial respondem 401. Um registro dinâmico de teste, com autorização PKCE, chegou à tela de consentimento da homologação, foi validado pela chave secreta nova e redirecionou ao login. Os dois clientes de teste foram apagados pela API administrativa (exclusão lógica).
- **Aceite com usuário real em 11/11/2026, pelo Claude.** O conector "BR Steel (homologação)" passou pelo provedor novo, pelo login do usuário piloto e pelo consentimento. Depois listou as 13 ferramentas de leitura. A ferramenta "Meu acesso" respondeu com a conta piloto, papel Administrador e as permissões `vendas:read`, `estoque:read`, `insumos:read` e `producao:read`. No projeto novo surgiram um usuário com a marca do recurso da homologação, um cliente "Claude" por registro dinâmico, um consentimento e as sessões com refresh. Ainda não foram observados um refresh real (após os 900 s do token) nem a revogação pelo Claude.
- **O Claude reaproveita a autorização antiga de uma URL.** Recriado com a mesma URL, o conector apareceu como "Conectado", sem ferramentas e sem registro no provedor novo. Foi preciso usar "Desvincular" e depois "Vincular" para iniciar um OAuth novo.

**A chave secreta precisa de `--reveal`.** Sem a flag, `supabase projects api-keys` devolve a chave secreta mascarada, com o prefixo `sb_secret_` correto. A primeira gravação na homologação usou esse valor, e a consulta de consentimento falhou com `Invalid API key` até a troca. Confira a chave contra a API REST do projeto antes de gravá-la.

### Produção: trocada em 11/11/2026

- O Site URL do projeto novo voltou para `https://br-steel.vercel.app`. A produção passa a rotear os consentimentos da homologação, como fazia no projeto antigo.
- `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` e `SUPABASE_SECRET_KEY` do projeto `br-steel` apontam para o projeto novo. Elas existem só no destino Production e ficaram gravadas como Secret.
- A publicação `dpl_BTjGPVFDWr2c9zd64BneVYSxMY7D` foi uma republicação da que saiu do merge (`b5c7f7a`) e já está em `br-steel.vercel.app`.
- Conferido:
  - os metadados do recurso de produção e de homologação anunciam o emissor novo;
  - o MCP sem token responde 401 e o login responde 200;
  - uma autorização de teste com recurso de produção chegou ao login da produção;
  - uma com recurso de homologação passou pela produção e foi redirecionada ao login da homologação. Os clientes de teste foram apagados.
- Aceite real pelo Claude: o conector "BR Steel" passou por "Desvincular" e "Vincular", login e consentimento, e listou as 13 ferramentas. "Meu acesso" e o resumo de vendas de 05/11 a 11/11 responderam com dados reais e fonte `firestore`.

Pendente:

1. Cada outra pessoa que usa o conector de produção precisa usar "Desvincular" e depois "Vincular" no Claude. O token antigo é recusado desde a publicação.
2. Observar um refresh real e uma revogação pelo Claude.
3. Encerrar o antigo depois de alguns dias sem uso: revogar sessões e papéis `brsteel_*` e pausar o projeto. A decisão de apagá-lo é do dono da organização Lunneta Ads.

Para voltar atrás: repor no projeto `br-steel` a URL e as chaves do projeto antigo (`supabase projects api-keys --project-ref mlumbvxpaqfzpdjnvzxc --reveal`) e republicar. O projeto antigo continua intacto.

## Próxima etapa: sair do Firebase

O corte do núcleo operacional vai direto para o projeto novo, sem passar pelo antigo. A exportação nova do Firestore foi importada e conferida no projeto novo em 11/11/2026: 18.998 registros, com `verify` aprovado (detalhes no Passo 3 do [roteiro do corte](../supabase/operational/cutover-rehearsal.md)). No mesmo dia, a homologação passou a ler dessa cópia: um login de runtime associado a `brsteel_ops_writer`, as duas variáveis de conexão no projeto de homologação e a chave `appConfig/operationalSource` no Firebase da homologação, que é separado do da produção. As leituras do MCP responderam com fonte `postgres` (detalhes em "Troca da fonte em homologação", no roteiro do corte). Faltam o ensaio do corte, o retorno nos dois sentidos e o corte da produção. O restante do Firebase fica fora desse corte e precisa de um levantamento próprio: login e usuários, acesso e auditoria do MCP, o registro `appConfig`, logs de webhook, eventos do Mercado Livre, histórico de anúncios e financeiro.

**Fase 1 (histórico em PostgreSQL), implementada em 11/11/2026 e publicada em produção pelo PR [#34](https://github.com/acassiusalves/br-steel/pull/34).** O log de observações de estoque e a série semanal de demanda por SKU agora existem em PostgreSQL: migration [`20261111120000_operational_history.sql`](../supabase/operational/migrations/20261111120000_operational_history.sql), gravação no caminho de ingestão de vendas, repositório trocável de demanda semanal e inclusão das duas coleções no export, import, `verify`, reconciliação e comparador. A migration foi aplicada em `mmewkphsrnttkzvpyddv` em 11/11/2026, numa transação, com `supabase db query --linked --project-ref mmewkphsrnttkzvpyddv -f` a partir de um diretório de trabalho novo. A consulta `operational_history` do [README operacional](../supabase/operational/README.md) devolveu 2. As duas tabelas têm o mesmo dono, as mesmas permissões e as mesmas quatro políticas de `stock_observations`. A carga de 11/11/2026 copiou 3.706 observações e 208 semanas de demanda. A produção não lê nem grava nelas enquanto `appConfig/operationalSource` não existir. O `scripts/backfill-sku-weekly-demand.ts` continua só no Firestore, porque roda antes do corte. Detalhes em [`cutover-rehearsal.md`](../supabase/operational/cutover-rehearsal.md).
