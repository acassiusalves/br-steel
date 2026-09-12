# Implantação MCP de leitura em produção

Autorizada pelo usuário em 12/09/2026 UTC: publicar o conector no BR Steel real, reutilizando usuários, permissões e banco operacional, inicialmente sem escrita de negócio. A preparação está local; **o conector de produção ainda não foi publicado nem habilitado**.

## Destino confirmado

| Recurso | Destino |
| --- | --- |
| Aplicação existente | `https://br-steel.vercel.app` |
| Projeto Vercel | `br-steel`, `prj_nKDQAAfkgJ7DePQsIZy5gMELWuWj`, Node 22.x |
| Endpoint previsto | `https://br-steel.vercel.app/api/mcp` — ainda não disponível |
| Banco operacional | Firestore `(default)`, projeto `marketflow-9h4tg`, região `nam5` |
| Provedor OAuth escolhido | Supabase `mlumbvxpaqfzpdjnvzxc` |
| Publicação atual preservada | `dpl_FJQePtgMfdmvtdLfLcdUaUwz1mkW` |

O domínio e a conta de serviço em produção apontam para esses destinos. A publicação anterior tem os três crons do Mercado Livre ativos; eles devem ser preservados. Os ambientes de teste mantêm seu banco e seu usuário piloto separados.

## Impedimento observado

O Firestore de produção retornou código 8, `Quota exceeded`, tanto nas consultas agregadas quanto na leitura isolada de `appSettings/general`. Não foi possível inventariar usuários, suas condições de primeiro acesso nem os dados operacionais. Isso é falha da consulta; **não significa banco vazio**.

A consulta administrativa confirmou `billingEnabled: false`, banco com `freeTier: true` e `open: false` na conta de faturamento vinculada. A regularização do faturamento exige ação/autorização explícita porque pode habilitar cobrança. Não houve reativação, troca de conta ou nova despesa autorizada nesta tarefa. O Google documenta a cota gratuita diária e sua renovação aproximadamente à meia-noite do Pacífico; essa renovação não equivale à regularização de uma conta encerrada. [Cotas do Firestore](https://firebase.google.com/docs/firestore/quotas).

As configurações atuais da Vercel, suas variáveis e as regras/índices do Firestore foram salvas privadamente para comparação e reversão. As regras atuais permitem acesso legado direto a usuários, permissões e dados de negócio. Por isso, a camada de autenticação e os consumidores web migrados precisam entrar antes de fechar essas coleções, e o MCP só pode ser habilitado depois desse fechamento.

## Preparação implementada

- `MCP_USER_ACCESS_MODE=authenticated` permite usuários com identidade OAuth e concessão válidas, sem uma segunda lista manual. Papel, páginas ativas, consentimento, versão de autenticação e revogação continuam verificados em cada chamada. O padrão continua `allowlist`; homologação recusa o modo aberto a usuários autenticados.
- Novas identidades OAuth recebem `app_metadata.brsteel_mcp_resource` pelo servidor. Identidade de outro ambiente é recusada. O hook preparado em `supabase/hosted/production/` emite uma única audiência para o recurso correto e preserva os tokens do piloto antigo. `user_metadata` não tem autoridade.
- `config/mcp-production.env.example` lista o ambiente sem segredos. `scripts/mcp-production-check.ts` valida offline os projetos, domínio, credenciais, flags, ausência de emuladores e preservação dos três crons. Aceita a preparação com MCP/OAuth desligados e a fase de leitura habilitada; sempre recusa escrita.
- O ambiente final foi preparado em arquivo privado, sem upload. A produção ainda não possuía `AUTH_SESSION_SECRET` nem `CRON_SECRET`; os novos valores são exclusivos. A troca do segredo de sessão exigirá novo login, preservando as senhas existentes. Contas ainda com senha inicial seguem o fluxo já implementado de troca pessoal antes de autorizar o Claude.

## Sequência de publicação

1. Restabelecer uma leitura no banco operacional. Inventariar os usuários e configurações atuais sem expor senhas, conferir datas/formato dos pedidos e observações de estoque, e selecionar registros reais para comparação. Não cadastrar fixtures nem alterar negócio em produção.
2. Comparar e provisionar os índices necessários preservando os dois índices existentes. Aguardar `READY`. Tratar retenção TTL conforme a situação de faturamento; não presumir que está habilitada.
3. Executar testes locais, revisão e build. Validar o ambiente por `node --import tsx scripts/mcp-production-check.ts` usando apenas as variáveis preparadas e o `vercel.json` efetivo. Não substituir o manifesto de produção pelo manifesto sem crons da homologação.
4. Publicar a aplicação migrada com `MCP_ENABLED=false` e `MCP_OAUTH_ENABLED=false`, sempre `MCP_WRITES_ENABLED=false`. Conferir novo login, primeiro acesso quando aplicável, perfis, telas e APIs dos módulos com os dados conhecidos. Recarregar as abas antigas para usar os novos consumidores autenticados.
5. Publicar as regras restritas após a migração dos consumidores. Conferir recusa anônima nas coleções migradas. Não habilitar MCP enquanto usuários/permissões puderem ser alterados diretamente por clientes anônimos.
6. Inventariar e salvar privadamente o hook/configuração do Supabase, aplicar atomicamente o SQL de produção e executar suas asserções/advisors. Atualizar Site URL e consentimento para o domínio real. Validar audiência de código/refresh, sessões comuns e continuidade do refresh do piloto; os testes SQL locais não substituem essa emissão real.
7. Publicar `MCP_ENABLED=true`, `MCP_OAUTH_ENABLED=true`, `MCP_USER_ACCESS_MODE=authenticated`, escrita desabilitada. Confirmar alias, crons, challenge HTTP 401 sem token e metadados canônicos.
8. Conectar o Claude com o login real do usuário, autorizar somente capacidades disponíveis e comparar as três leituras com os registros conhecidos. Validar recusa por permissão, revogação e reconexão. Não fabricar cookies nem usar credenciais de serviço como se fossem uma autenticação de usuário.

A preparação não faz push/merge nem altera a branch principal. Antes de integrar ao GitHub, considerar que a branch contém também a migração necessária da autenticação e dos consumidores web; não publicar apenas a rota MCP isoladamente.

## Verificação da preparação

Em 12/09/2026 UTC, a suíte local passou com 157 testes em 26 arquivos e o build terminou com sucesso. A checagem TypeScript continua com os mesmos 25 erros preexistentes, sem erros novos. Após uma correção apenas na tipagem do ambiente do teste de subprocesso, os quatro testes de produção passaram novamente e a comparação TypeScript permaneceu idêntica à base.

O validador offline passou nas duas fases usando a configuração privada preparada e o manifesto real, sempre com escrita desabilitada. A primeira fase tem **ambas** as flags MCP e OAuth desligadas; o resumo `preparation` do validador, isoladamente, não comprova isso. O teste SQL local confirmou seleção de audiência, preservação das permissões, reversão e recusa de ACL insegura. A revisão independente não encontrou defeitos acionáveis, inclusive na correção final do teste.

Esses resultados verificam a preparação local. Inventário operacional, publicação, regras/índices em produção, emissão real de tokens de produção e aceitação pelo Claude continuam pendentes. Nenhuma mudança de faturamento, Vercel, Firebase ou Supabase foi aplicada nesta etapa. Evidência sanitizada em `docs/evidence/mcp-production-preparation-2026-09-12.json`.

## Reversão

Desabilitar o conector antes de desfazer sua configuração. Preservar o backup real do hook e das variáveis para restaurar somente as mudanças desta implantação. As instruções de reversão SQL estão em `supabase/hosted/production/README.md`.

Depois de fechar as regras, não restaurar o frontend antigo isoladamente: seus leitores diretos deixarão de funcionar. Uma falha nessa fase pede correção mantendo as regras protegidas, ou uma reversão coordenada especificamente revisada. Os backups não autorizam reabrir automaticamente coleções sensíveis.
