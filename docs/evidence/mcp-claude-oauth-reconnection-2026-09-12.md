# Reconexão OAuth pelo Claude no Chrome — 12/09/2026

**Resultado: falha no redirecionamento automático; conexão recuperada manualmente.** O conector BR Stell voltou a ficar conectado e uma chamada real a `consultar_meu_acesso` funcionou após novo login e consentimento. O fluxo automático completo ainda não está aprovado.

## Reprodução

1. No Chrome já autenticado no Claude, abrir o conector BR Stell, cujo servidor é `https://br-steel-mcp-staging.vercel.app/api/mcp`.
2. Desvincular e confirmar. A interface mostrou que o conector estava desconectado.
3. Clicar em Vincular. O navegador chegou ao login de **produção**, em `https://br-steel.vercel.app/login`, com retorno para `/oauth/consent` e o identificador da nova autorização.

Esse destino não corresponde ao ambiente de usuários/dados do recurso MCP selecionado. As credenciais de homologação não foram submetidas à produção. Nenhuma configuração global de autenticação ou deployment foi alterada para executar o teste.

## Causa confirmada

As duas URLs públicas `/.well-known/oauth-protected-resource/api/mcp` informaram o mesmo servidor de autorização: `https://mlumbvxpaqfzpdjnvzxc.supabase.co/auth/v1`, cada uma com seu próprio `resource`. A configuração registrada na [evidência de produção](mcp-production-readonly-2026-09-12.json) usa Site URL de produção e caminho `/oauth/consent`; o destino observado no navegador coincide com essa combinação.

O Supabase combina Site URL e Authorization Path para construir a página de consentimento. A lista de URLs permitidas não escolhe automaticamente o ambiente de consentimento para cada recurso MCP. [Documentação oficial consultada em 12/09/2026](https://supabase.com/docs/guides/auth/oauth-server/getting-started#configure-your-authorization-path).

## Recuperação e verificação

Para recuperar a conexão, foi aberto manualmente o mesmo caminho de consentimento na origem de homologação, preservando a solicitação iniciada pelo Claude. O navegador pediu login; o e-mail da conta de piloto foi preenchido e o Chrome completou a senha salva. O login funcionou sem redefinição de credenciais.

A tela de consentimento identificou a conta de piloto e o aplicativo Claude, com retorno para `https://claude.ai/api/mcp/auth_callback`. Foram mantidas as mesmas quatro capacidades: `vendas:read`, `estoque:read`, `insumos:read` e `producao:read`. O consentimento foi concluído, o callback retornou com sucesso e o Claude exibiu “Conectado a BR Stell”, com 12 ferramentas de leitura ainda exigindo aprovação individual.

Em uma conversa nova, o Claude executou `consultar_meu_acesso` uma vez, com “Permitir uma vez”. O retorno original foi inspecionado: perfil Administrador, as quatro capacidades acima, cinco páginas permitidas, `source: firestore`, `asOf: 2026-09-12T21:40:37.575Z`, sem avisos. Isso confirma uma chamada autenticada após a reconexão recuperada. Nenhuma ferramenta de negócio, escrita ou outro conector foi acionado.

O conector foi deixado conectado. Não houve ativação da cópia PostgreSQL, nova publicação, alteração de perfil ou ampliação de permissões. Senhas, tokens e identificadores transitórios da autorização não foram incluídos nesta evidência.

## Pendência

Corrigir a seleção do ambiente de consentimento antes de considerar a reconexão automática aprovada. Trocar globalmente o Site URL para homologação deslocaria também o fluxo de produção e não foi usado como correção. A solução precisa preservar a identidade e o recurso de cada ambiente; depois deve ser testada novamente desde o botão Vincular, sem ajuste manual da URL. A autenticação OAuth de produção com um usuário real não foi testada nesta execução.
