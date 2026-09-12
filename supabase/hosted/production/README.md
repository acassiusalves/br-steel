# Audiência OAuth de produção

Configuração exclusiva para Supabase `mlumbvxpaqfzpdjnvzxc`. O recurso de produção é `https://br-steel.vercel.app/api/mcp`; o legado é `https://br-steel-mcp-staging.vercel.app/api/mcp`. Nenhum arquivo de homologação foi alterado. Estes artefatos ficam fora da cadeia local `supabase/migrations`; não usar `db push`.

Somente `claims.client_id` não vazio aciona a seleção. Dentro de `claims.app_metadata`, `brsteel_mcp_resource` exatamente igual ao recurso de produção seleciona produção; exatamente igual a homologação seleciona homologação. Chave ausente, JSON `null` e string vazia selecionam homologação para preservar o piloto. Qualquer outro valor não vazio, incluindo espaços, URL com barra extra, número, objeto ou array, aborta com SQLSTATE `22023`. `user_metadata` e `client_id` fora de `claims` nunca autorizam nem selecionam audiência. Sem cliente OAuth, o objeto `claims` permanece JSONB-idêntico, inclusive sua audiência; o envelope de retorno continua `{claims: ...}`, como no hook anterior. A saída OAuth tem uma única audiência string, nunca um array.

A migration contém um único `DO` atômico, inclusive o `CREATE OR REPLACE` dinâmico. Exige o hook privado existente com ACL segura antes de substituí-lo. Mantém `STABLE`, `SECURITY INVOKER`, `search_path = ''` e compara proprietário/ACL exatos da função e do schema antes/depois. Não contém `GRANT`, `REVOKE`, criação de schema, tabelas ou alterações de usuários. Concessões inesperadas ou privilégios de API abortam a aplicação. A seleção externa do hook no Auth e os schemas expostos ainda precisam ser conferidos; não são comprovados pelo SQL.

## Aplicação pelo responsável da publicação

Não aplicar enquanto a disponibilidade do Firestore de produção e a sequência de publicação aprovadas estiverem pendentes. Antes de executar, revisar este SQL e o estado atual do provedor. A CLI deve sempre selecionar explicitamente o projeto conhecido; a constante no backup não descobre nem comprova identidade do servidor.

1. Guardar um backup privado da definição, proprietário e ACL atuais com `backup.sql`; exigir exatamente um resultado. Conferir também `../inventory.sql` e salvar a configuração atual do Auth (hook selecionado, Site URL, redirects e configuração OAuth) sem registrar segredos. Conferir que `private` continua fora da Data API e que não existem consumidores OAuth adicionais incompatíveis.
2. Comparar a definição atual com o hook de homologação histórico. Se houver alterações posteriores, adaptar a mudança e a reversão antes de aplicar. Não substituir código desconhecido apenas porque suas ACL passam.
3. Aplicar a migration inteira em uma única chamada; não dividir seu conteúdo. O arquivo foi criado por `supabase migration new mcp_production_oauth_audience` com CLI 2.114.0 em diretório temporário isolado.
4. Executar o teste CLI e capturar novamente `backup.sql` para comparar proprietário/ACL. Inspecionar advisors de segurança e a configuração externa. Somente o responsável da publicação altera Site URL/configuração e habilita a aplicação, conforme o plano de produção.

Comandos executados na raiz do worktree em 12/09/2026 UTC, após a aplicação migrada e as regras restritas entrarem em produção:

```sh
supabase db query --linked --project-ref mlumbvxpaqfzpdjnvzxc --file supabase/hosted/production/backup.sql --output-format json
supabase db query --linked --project-ref mlumbvxpaqfzpdjnvzxc --file supabase/hosted/production/migrations/20260912003415_mcp_production_oauth_audience.sql --output-format json
supabase db query --linked --project-ref mlumbvxpaqfzpdjnvzxc --file supabase/hosted/production/tests/mcp_access_token_hook_cli.sql --output-format json
```

O teste é um único `DO`, sem alteração persistente, troca de papel ou leitura de usuários. Abrange código e refresh para ambas as audiências, piloto legado, marcadores ausente/nulo/vazio/inválido, audiência única, falsificação por metadados, sessões comuns intactas e ACL. Executa como o chamador da CLI; não conceder membership para contornar restrições do serviço.

Após ativação, validar emissão real de código e refresh de produção com assinatura/JWKS, issuer, client_id e audiência exata, refresh do piloto com audiência de homologação e sessão comum preservada. Apenas essa emissão comprova integração real do Auth; fixtures SQL não substituem usuários/grants legítimos e não devem ser inseridas em produção.

## Reversão

Desabilitar MCP/OAuth de produção na aplicação antes de voltar a audiência. Capturar novamente definição/ACL/configuração para detectar mudanças posteriores. Preferir restaurar a definição exata salva por `backup.sql` usando `CREATE OR REPLACE`, em uma transação; não derrubar/recriar a função nem reaplicar grants amplos. Restaurar a configuração externa do Auth/Site URL somente conforme o backup e os consumidores ativos.

`rollback_to_staging.sql` oferece uma reversão atômica para a definição histórica conhecida, com as mesmas pré-condições e preservação exata de ACL/proprietário. Usá-lo somente se o backup comprovar que essa era a definição anterior; caso contrário, restaurar a definição salva. Executar o teste histórico `supabase/hosted/tests/mcp_access_token_hook_cli.sql` depois. A reversão faz todos os clientes OAuth receberem a audiência de homologação; por isso produção deve estar desabilitada. Tokens já emitidos continuam válidos até expiração/revogação; alterar a função não revoga tokens.

## Verificação local realizada

Em 12/09/2026 UTC, todos os quatro arquivos SQL e as duas definições dinâmicas passaram por `pglast` 7.18 (`parse_sql` e, quando aplicável, `parse_plpgsql`). O runner `tests/verify_local.cjs` executou PostgreSQL em memória via PGlite já disponível no cache local: instalou apenas os papéis sintéticos e o hook histórico na instância isolada, aplicou a migration, executou as asserções como proprietário e como `supabase_auth_admin` simulado, verificou ACL/proprietário idênticos, reverteu e passou as asserções históricas, reaplicou duas vezes e recusou uma ACL insegura. Tudo passou. Nenhum stack Supabase/emulador ou serviço compartilhado foi iniciado ou alterado.

Reproduzir com Node e um pacote `@electric-sql/pglite` disponível, ou definir `BRSTEEL_PGLITE_MODULE` para o caminho absoluto de uma instalação existente:

```sh
node supabase/hosted/production/tests/verify_local.cjs
```

A migration foi aplicada remotamente em 12/09/2026 UTC. As asserções CLI passaram e a comparação independente dos backups confirmou proprietário, ACL da função/schema, search_path e SECURITY INVOKER preservados. O painel confirmou o hook selecionado em private e esse schema fora da Data API. Site URL agora é https://br-steel.vercel.app; os retornos exatos de produção e homologação estão autorizados, OAuth/DCR seguem habilitados e Authorization Path permanece /oauth/consent.

Os advisors não encontraram problemas de banco/função; retornaram apenas o aviso de proteção de senhas vazadas desativada no Auth. O login BR Steel usa sua própria autenticação e a ponte não solicita senha Supabase do usuário; não foi alterada a política de senhas do provedor. Emissão real de código/refresh de produção, refresh do piloto e aceitação no Claude ainda aguardam um fluxo legítimo de usuário. As asserções SQL não substituem essas verificações.

Consultados o [changelog Supabase](https://supabase.com/changelog) e a documentação de [Custom Access Token Hook](https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook). As mudanças listadas de schemas gerenciados e infraestrutura self-hosted não alteram este hook privado no projeto hospedado.
