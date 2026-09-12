# Etapa 2 — OAuth local com o login do BR Steel

Implementação em `codex/mcp-auth-foundation`, sobre a etapa 1 (`6a1028f`), validada em 11/09/2026. O usuário pode autorizar um cliente OAuth com sua conta do BR Steel. O fluxo foi comprovado com Supabase real local e Firestore Emulator, exclusivamente com cadastros sintéticos.

## O que foi entregue

- Provedor Supabase dedicado de identidade, OAuth/DCR, PKCE S256, assinatura ES256, audiência exclusiva do MCP e refresh rotativo. Configuração e prova independente em [mcp-oauth-provider-local.md](mcp-oauth-provider-local.md).
- Ponte que resolve o usuário pelo cookie web, recarrega cadastro/permissões e exige conclusão do primeiro acesso. Reserva um UUID imutável antes de provisionar a identidade; não adota outra conta por coincidência de e-mail.
- OTP gerado e consumido no backend, sem enviar e-mail. A sessão auxiliar fica em cookie JWE cifrado, HttpOnly e SameSite=Lax, vinculada ao usuário e à versão de autenticação, por no máximo 10 minutos. JSON não contém OTP, access token ou refresh token.
- `/oauth/consent` apresenta conta, aplicativo, callback registrado, escopos OAuth e capacidades realmente disponíveis. Login e primeiro acesso preservam apenas um retorno canônico para esse consentimento. Escritas só aparecem com `MCP_WRITES_ENABLED=true`, e começam desmarcadas.
- Concessão durável `pending → active`, decisão única e rollback. O backend revalida as permissões antes de aprovar. Consentimento antigo do provedor não amplia capacidades locais.
- API de conexões do próprio usuário e revogação local antes de qualquer chamada ao provedor, inclusive antes do OTP. Uma concessão pendente de revogação não pode ser reativada.
- Verificador de token com JWKS, algoritmo assimétrico permitido, issuer, audience, expiração, identidade, `client_id`, concessão ativa, `authVersion` e `iat >= validAfter`. O corte cruza o próximo segundo antes de emitir nova autorização, impedindo que JWT antigo volte a valer após reconexão.
- Coleções `mcpIdentities`, `mcpIdentityBindings`, `mcpAuthorizationIntents` e `mcpConnections` inacessíveis ao SDK do navegador, inclusive com claim Firebase de administrador.

O Supabase cuida somente da identidade OAuth. Vendas, estoque, produção e permissões permanecem no Firestore. As futuras ferramentas devem passar pelo verificador e pela política de capacidades em cada operação; receber um contexto autenticado não dispensa verificar a operação solicitada.

## Evidência

| Verificação | Resultado |
| --- | --- |
| Build Next.js | Passou; avisos nas dependências Genkit/OpenTelemetry/Handlebars |
| Typecheck independente | Os mesmos 25 diagnósticos anteriores, comparados linha a linha; nenhum novo |
| Pacotes estáticos do navegador | 106 arquivos verificados; nenhuma ocorrência da chave secreta Supabase ou segredo de sessão |
| Vitest, `tests/access` e `tests/oauth`, Firestore real emulado | **63 testes passaram** em 9 arquivos |
| Aplicação Next + provedor real | Discovery → DCR → PKCE → login → primeiro acesso → consentimento → código → token → refresh → revogação → reconexão: passou |
| Token de sessão comum em recurso MCP | Recusado por audiência |
| Mudança do perfil local após emissão | Consultada na próxima validação; operação de vendas negada ao Operador |
| Access e refresh antigos após revogar e reconectar | Permaneceram recusados |
| PKCE incorreto e redirect alterado | Recusados na prova independente do provedor |
| Indisponibilidade antes do OTP de revogação | Concessão já bloqueada localmente; regressão coberta |
| Timeout após possível envio da revogação | Lock mantido; retry e reconexão bloqueados, sem liberar corrida com resposta atrasada |
| Revisão de código | Dois achados corrigidos com testes que falharam antes; reavaliação aprovada |
| Navegador | Login de administrador retorna ao mesmo consentimento; capacidades de Vendedor limitadas a vendas/estoque; recusa retorna ao callback; aprovação e revogação funcionam; primeiro acesso do Operador leva ao perfil preservando o identificador |

O teste HTTP completo foi concluído às **19:20:36 UTC**. Seu resultado sanitizado inclui `firstAccessAndSafeReturn`, `discoveryDcrPkceLoginConsentCodeToken`, `normalSessionRejected`, `refreshValidated`, `currentRoleEnforced`, `localAndProviderRevocation`, `oldTokensRemainRejectedAfterReconnect` e `denialReturnedToClient`, todos verdadeiros. Ele usa as rotas HTTP da aplicação e o próprio verificador de tokens do backend, sem simular o Supabase.

A troca de senha foi testada pelas rotas HTTP reais e pelos testes de regressão; no navegador foi verificado o encaminhamento para o primeiro acesso. Clientes e identidades sintéticas da prova HTTP e da validação visual foram removidos ao final. Next, callback, Firestore Emulator e somente o projeto Supabase local `brsteel-mcp-oauth` foram encerrados; configuração e volume de teste foram preservados.

## Reproduzir em ambiente isolado

Requer Node **22.x** (validado 22.19.0; o executor HTTP usa `registerHooks`, disponível a partir de 22.15), Java e Docker, dependências instaladas e Supabase CLI 2.114.0.

1. Iniciar o provedor com `node scripts/oauth-provider-local.mjs`.
2. Em um checkout de teste, preparar `.env.local` com os valores de `.env.oauth.local` e as variáveis abaixo. Ambos são ignorados pelo Git. Não sobrescrever a configuração de outro ambiente.
3. Iniciar Firestore Emulator e Next em terminais separados.
4. Executar a prova HTTP com `npm run test:oauth-app`. O executor apenas adapta a marca `server-only` para execução Node no emulador; aplicação, persistência, SDK e validação JWT continuam reais.

Variáveis adicionais para a aplicação local:

```dotenv
AUTH_SESSION_SECRET=<segredo-aleatorio-local-com-pelo-menos-32-caracteres>
FIRESTORE_EMULATOR_HOST=127.0.0.1:8188
GCLOUD_PROJECT=demo-brsteel-auth
NEXT_PUBLIC_FIREBASE_PROJECT_ID=demo-brsteel-auth
NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST=127.0.0.1:8188
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=demo-brsteel-auth.invalid
MCP_WRITES_ENABLED=false
```

Comandos, a partir da raiz do checkout:

```sh
npx --yes firebase-tools@14.16.0 emulators:start --only firestore --project demo-brsteel-auth --config firebase.test.json
npm run dev -- --hostname 127.0.0.1
npm run test:oauth-app
npm run test:oauth-provider
```

Os dois primeiros são processos separados. Com o emulador iniciado, a suíte de regressão é `npx vitest run tests/access tests/oauth`. Ela limpa o projeto `demo-brsteel-auth`: executar separadamente da validação visual ou HTTP para não apagar fixtures em uso. Alternativamente, usar `firebase-tools@14.16.0 emulators:exec` com o mesmo projeto/configuração para iniciar e encerrar o emulador junto da suíte.

O navegador da aplicação nunca recebe a chave secreta do Supabase. Não usar `NEXT_PUBLIC_` para essa chave. As chaves locais são geradas pelo setup e ficam fora do Git; somente endpoints e evidências sem credenciais são versionados.

## Decisões e limites desta entrega

- **Identificador opaco:** GoTrue v2.195.0 emite `authorization_id` aleatório, não UUID. A validação compartilhada aceita 16–128 caracteres alfanuméricos, `_` e `-`, rejeitando sintaxe de caminho. IDs de usuário e cliente continuam UUIDs. A diferença foi descoberta no teste real e ganhou regressão.
- **Reconsentimento:** o provedor pode retornar diretamente um código para uma autorização anterior, inclusive com `prompt=consent`. O BR Steel bloqueia esse caminho e oferece revogar/reconectar. A consulta de detalhes não é prova de uma nova decisão do usuário.
- **Falha ambígua:** se uma revogação pode continuar em andamento no provedor, o registro permanece bloqueado. Somente uma falha comprovadamente anterior ao envio permite liberar o lock para retry. Não há expiração automática desse lock. Uma interrupção do processo durante aprovação/revogação exige recuperação operacional; a concessão permanece sem acesso. Não limpar `pending` ou `revocationAttempt` nem marcar `active` apenas pelo tempo transcorrido. Para recuperação, é necessário garantir que a operação antiga encerrou e revogar o grant no provedor antes de liberar reconexão; alternativamente, manter o cliente antigo bloqueado e usar um novo `client_id`.
- **Tempo e retenção:** intenções expiram logicamente em cinco minutos. TTL/limpeza física e runbook de recuperação do ambiente hospedado entram na preparação do piloto; arquivos locais não são implantação de regras, índices ou TTL.
- **MCP público:** `/api/mcp`, catálogo de ferramentas e conexão do Claude hospedado pertencem às etapas seguintes. Esta prova não significa que o Claude já possa ler ou escrever nos dados reais.
- **Ambiente:** nenhum recurso cloud, deploy, push ou dado operacional foi alterado. Audiência, portas e hook desta configuração são locais; o ambiente publicado precisará de seu domínio canônico e configuração próprios.

O próximo trabalho é a etapa 3: serviços de vendas, estoque/insumos e produção com autorização no backend, compartilhados pela interface web e pelas ferramentas MCP.
