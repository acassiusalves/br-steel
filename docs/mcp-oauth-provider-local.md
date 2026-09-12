# Provedor OAuth local do MCP

Ambiente dedicado de identidade da Etapa 2, validado em 11/09/2026. Não contém dados operacionais; pedidos, estoque, produção, vínculos e concessões do BR Steel permanecem no Firestore. Nenhum projeto cloud foi criado ou alterado.

## Inicialização reproduzível

Pré-requisitos: Node.js 22+, Supabase CLI **2.114.0**, Docker em execução e dependências do repositório instaladas. Versões usadas: Node.js 22.19.0, Docker 29.5.2, `@supabase/supabase-js` 2.116.0.

```sh
node scripts/oauth-provider-local.mjs
```

O script gera chaves ES256 e chaves de API próprias na primeira execução; cria somente a rede `brsteel-mcp-oauth-local`; inicia somente o projeto `brsteel-mcp-oauth`; aplica as migrations locais; verifica os bindings das portas; grava `.env.oauth.local` com permissão `0600`. É seguro executá-lo novamente com o ambiente iniciado. Não imprime credenciais. Nunca usar `supabase stop --all` neste fluxo.

Arquivos locais ignorados pelo Git:

- `supabase/.env.signing-keys.local`: chave privada ES256, gerada pelo CLI no caminho configurado.
- `supabase/.env.local`: valores aleatórios das chaves pública/secreta de API e do segredo JWT de compatibilidade. O CLI lê esse arquivo. As chaves opacas padrão do CLI são determinísticas, por isso são substituídas.
- `.env.oauth.local`: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `APP_ORIGIN`, `MCP_PUBLIC_URL` e `MCP_OAUTH_ENABLED=true`, consumidos pela aplicação local. Outros valores já presentes são preservados pelo script.
- `supabase/.env.start.local`: diagnóstico privado, criado apenas quando um comando do setup falha. Pode conter segredos e não deve ser copiado para evidências.

Para parar somente este provedor, preservando seus dados de teste:

```sh
supabase stop --project-id brsteel-mcp-oauth
```

Para iniciar um ambiente totalmente novo, use uma cópia limpa do repositório com essas portas disponíveis; o script gera novas chaves. Não remova arquivos de chave de uma instância ativa: a rotação exige parada, substituição das chaves, reinício e atualização do ambiente da aplicação.

## Configuração comprovada

| Item | Valor |
| --- | --- |
| Projeto local | `brsteel-mcp-oauth` |
| API | `http://127.0.0.1:55321` |
| Banco | `127.0.0.1:55322`, shadow port `55320` |
| Aplicação / consentimento | `http://localhost:9003` / `/oauth/consent` |
| Issuer | `http://127.0.0.1:55321/auth/v1` |
| Audiência MCP | `http://localhost:9003/api/mcp` |
| Assinatura / duração | ES256 / 900 segundos |
| Rotação de refresh | Habilitada; intervalo de reuso configurado em zero |
| Registro de clientes | DCR habilitado; clientes públicos de teste usam `token_endpoint_auth_method=none` e PKCE S256 |
| Cadastro público / anônimo | Desabilitado; provisionamento pelo backend administrativo |
| Serviços ativos | Postgres `17.6.1.158`, GoTrue `v2.195.0`, Kong `2.8.1` |
| Binding no host | API e banco somente em `127.0.0.1`; Auth sem porta publicada |

Realtime, Storage, Studio, SMTP local, Edge Runtime, Analytics, Vector e pooler estão desativados/excluídos. Desde a correção de roteamento de consentimento, PostgREST também é iniciado para servir a RPC `public.brsteel_mcp_consent_resource(text)`, executável apenas pelo servidor com `service_role` (e pelo proprietário). A migration local aceita apenas os recursos de loopback na porta 9003. O namespace privado contém apenas a função `private.mcp_access_token_hook(jsonb)`, `SECURITY INVOKER`, com `search_path=''`. Somente `supabase_auth_admin`, além do proprietário, recebe execução do hook. `anon`, `authenticated` e `service_role` não podem executá-lo; não há tabelas em `public`/`private`.

A audiência é ajustada quando `event.claims.client_id` é uma string não vazia. Essa posição foi comprovada em emissões reais de código e refresh. Sessões comuns, inclusive seu refresh, mantêm `aud=authenticated`. Nenhum campo de `user_metadata` participa da decisão. A URL da audiência nesta migration é deliberadamente **local**; a configuração de um futuro ambiente publicado requer URL canônica e migration próprias.

## Verificação executável

```sh
node scripts/oauth-provider-verify.mjs
docker exec -i supabase_db_brsteel-mcp-oauth sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" psql -h 127.0.0.1 -U supabase_auth_admin -d postgres -v ON_ERROR_STOP=1' < supabase/tests/mcp_access_token_hook.sql
supabase db advisors --local --type security --level warn --fail-on warn
supabase migration list --local
```

O teste HTTP/SDK recusa endpoints diferentes do provedor local, cria usuário e cliente sintéticos e remove ambos em `finally`. Usa `admin.createUser({id: UUID reservado, ...})`, `generateLink` e `verifyOtp` para criar a sessão sem enviar e-mail. Não chama a aplicação, Claude, Firestore ou Bling. O callback `http://localhost:45454/oauth/callback` serve apenas para validar o retorno; o teste lê o redirect sem abrir essa URL.

Resultado comprovado às 18:52:52 UTC de 11/09/2026:

- Descoberta, DCR, identidade com UUID reservado, OTP, consentimento, PKCE S256, troca de código e assinatura via JWKS: passaram.
- Token OAuth e seu refresh: `alg=ES256`, `iss=http://127.0.0.1:55321/auth/v1`, `aud=http://localhost:9003/api/mcp`, `sub` e `client_id` presentes, `exp-iat=900`.
- Sessão comum e seu refresh: `aud=authenticated`, sem `client_id`.
- Verificador PKCE errado, redirect diferente na autorização e na troca, e audiência errada no verificador JWT: recusados.
- Refresh emite token de refresh diferente. Revogação invalida os refresh tokens anteriores; continuam recusados após reconexão do mesmo cliente/usuário.
- SQL executado como `supabase_auth_admin`: hook distingue OAuth de metadata editável, preserva sessões comuns e respeita permissões. Advisors de segurança: **nenhum problema**. Migration `20260911184433` aplicada.

Exemplo de claims da execução sintética (a identidade e o cliente já foram removidos):

```json
{
  "alg": "ES256",
  "iss": "http://127.0.0.1:55321/auth/v1",
  "aud": "http://localhost:9003/api/mcp",
  "sub": "b89f387c-f711-4d60-b40d-daca71837845",
  "client_id": "d71b0d84-b178-46e5-a6a7-9a6d042114ff",
  "iat": 1789152772,
  "exp": 1789153672
}
```

## Particularidades verificadas

1. **Consentimento repetido:** `getAuthorizationDetails(id)` pode aprovar automaticamente uma concessão existente e retornar somente `redirect_url`, já contendo código. `prompt=consent` em `/oauth/authorize` não alterou esse comportamento no GoTrue v2.195.0. Não usar esse retorno para ampliar capacidades locais. A aplicação deve recusar o caminho quando precisa de nova decisão e orientar revogação/reconexão.
2. **SDK:** os detalhes usam `data.client.id`; a revogação é `auth.oauth.revokeGrant({ clientId })`. `approveAuthorization(id, {skipBrowserRedirect:true})` e `denyAuthorization` evitam navegação automática no browser. A documentação narrativa ainda apresenta uma assinatura de revogação com string.
3. **Revogação:** os refresh tokens antigos retornaram HTTP 400 com `error_code=refresh_token_not_found`; o provedor nem sempre usa o envelope OAuth `error=invalid_grant`. Tokens de acesso antigos continuam com assinatura válida até `exp`: o MCP deve checar concessão ativa e `validAfter` em cada operação.
4. **Discovery local:** Kong atende `/auth/v1/.well-known/oauth-authorization-server` e `/auth/v1/.well-known/openid-configuration`. A URL de inserção RFC 8414 `/.well-known/oauth-authorization-server/auth/v1` documentada para projetos hospedados retornou 404 neste stack. O teste consome os endpoints anunciados pelo discovery disponível; compatibilidade de descoberta do Claude hospedado continua dependendo de um ambiente público futuro.
5. **CLI:** com `signing_keys_path` configurado, `gen signing-key` grava no arquivo; não redirecionar stdout para o próprio arquivo de entrada. O setup cria inicialmente um array vazio. Alguns erros do CLI usam envelope JSON `_tag=Error` com exit status zero, tratado pelo script. `db query --file` não aceita múltiplos comandos no prepared statement desta versão; o teste SQL transacional usa `psql` dentro do container dedicado.
6. **Escopos:** o discovery anuncia escopos OIDC e `offline_access`; capacidades como `vendas:read` continuam sendo concessões do BR Steel. O discovery também anuncia PKCE `plain`; esta prova usa e valida `S256`.

Fontes verificadas: [changelog](https://supabase.com/changelog), [início do OAuth Server](https://supabase.com/docs/guides/auth/oauth-server/getting-started), [fluxos OAuth](https://supabase.com/docs/guides/auth/oauth-server/oauth-flows), [contrato do hook](https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook), [segurança dos tokens](https://supabase.com/docs/guides/auth/oauth-server/token-security). Os avisos de mudança de [API_EXTERNAL_URL](https://supabase.com/changelog/47093-self-hosted-supabase-api-external-url-to-include-auth-v1) e [gateway Envoy](https://supabase.com/changelog/48048-self-hosted-supabase-envoy-becomes-the-default-api-gateway-b) foram conferidos; as versões efetivamente iniciadas pelo CLI acima são a referência desta prova.
