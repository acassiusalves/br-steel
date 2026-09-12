# OAuth: ambiente correto antes do login

Em 12/09/2026, a reconexão real no Chrome passou sem edição manual da URL.
O conector existente BR Stell aponta para o MCP de homologação. Ao clicar em
Vincular, o fluxo chegou automaticamente a
`https://br-steel-mcp-staging.vercel.app/oauth/consent`, mostrou a conta sintética
do piloto e retornou ao Claude com a confirmação de conexão.

O provedor compartilhado mantém Site URL de produção e Authorization Path
`/oauth/consent`. A página inicial agora consulta o `resource` armazenado na
autorização pendente antes de ler a sessão local ou escolher a tela de login.
Os destinos aceitos são exatos; autorizações ausentes, expiradas, usadas ou de
outros recursos são recusadas. O POST de sessão repete a verificação antes de
provisionar uma identidade. A sessão existente de homologação foi reutilizada
no teste do navegador; não foi necessário digitar uma senha novamente.

## Verificações

- Regressão reproduzida antes da correção: 9 de 11 novos casos falharam pelo
  desvio de ambiente, fallback indevido para login ou provisionamento cruzado.
- Suíte de acesso/OAuth/MCP/operações: **164 testes em 26 arquivos passaram**.
- Após acrescentar asserções de ausência de leitura de cookies, os 18 testes
  diretamente afetados de roteamento e adapter passaram novamente.
- SQL hospedado e equivalente local: fixtures descartáveis em PostgreSQL 17,
  chamadas reais como service_role, recursos válidos/inválidos, validade/status
  e ACLs passaram. Nenhuma fixture foi inserida no provedor hospedado.
- Stack Supabase local real, incluindo PostgREST: discovery, DCR, PKCE,
  consentimento, tokens, refresh/revogação e nova RPC passaram. A RPC funciona
  com a chave secreta; chamadas anônimas e autenticadas comuns são recusadas
  com `42501`; autorização já aprovada retorna null.
- Build local de homologação e builds publicados de ambos os ambientes passaram.
  Typecheck continua com 25 diagnósticos preexistentes fora desta alteração;
  não há diagnóstico novo nos arquivos alterados. O build do projeto já ignora
  esses erros de tipos.
- Revisão independente: dois apontamentos corrigidos (PostgREST no bootstrap
  local e asserção de cookies); nenhuma pendência após a revisão final.
- Smoke HTTP nos dois domínios públicos: autorização inexistente exibe erro de
  validação e não segue para login.

## Publicação e permissões

Implementação: `cf12409d2b5f09cceeeb36bcf03f161504cc96f9`, isolada a partir de
`cb6399cf1fe9d7906299604b3d03fc26ad6729c1` (main). A migração operacional para
Postgres permanece em outra branch e não foi incluída nesta publicação.

| Item | Aplicado / validado |
| --- | --- |
| Provedor | `mlumbvxpaqfzpdjnvzxc`, migration `mcp_consent_resource` |
| RPC | `public.brsteel_mcp_consent_resource(text)` |
| Proprietário / execução | postgres; apenas postgres e service_role |
| Proteções SQL | SECURITY DEFINER, search_path vazio, timeout de 3 segundos |
| Acesso à tabela Auth | service_role continua sem SELECT direto |
| API hospedada | chave secreta retorna null para ID inexistente; anônimo recebe HTTP 401 |
| Homologação testada | `dpl_HEQv1wM4NqeS6o4hEtS6L4QFK5gu`, sem crons |
| Produção testada | `dpl_wpTY7QNcwEa6Xg77sqfqC2dDTHs6`, três crons preservados |
| Rollback anterior de homologação | `dpl_3K3Xt92mbCFYSdNUsiPBRswE5kqk` |
| Rollback anterior de produção | `dpl_5j2BBDFg73UAnkiYywsEEL3UxTuj` |

O advisor de segurança não encontrou problema SQL nesta função. Sinalizou a
configuração de [proteção contra senhas vazadas desativada](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)
no Auth do projeto, fora do escopo desta correção.

O deploy preservou variáveis, contas Firebase, issuer, scopes, controles de acesso
e escrita desabilitada. Não foi substituído o segredo protegido do webhook.
Os manifests de upload excluíram arquivos privados e credenciais. As cópias
temporárias das credenciais de nuvem foram removidas após a publicação.

## Prova no Claude

1. Desvincular e vincular novamente o conector existente.
2. Consentimento abriu automaticamente em homologação, sem alterar o endereço.
3. Conta: Piloto MCP BR Steel; callback exibido: `https://claude.ai/api/mcp/auth_callback`.
4. Mantidas as quatro permissões de leitura já existentes; retorno ao Claude
   mostrou “Conectado a BR Stell”, com 12 ferramentas que exigem aprovação.
5. Executada apenas `Meu acesso`, com “Permitir uma vez”. A resposta original
   da ferramenta foi conferida, além do texto do Claude.

Resultado: Administrador; `vendas:read`, `estoque:read`, `insumos:read` e
`producao:read`; fonte `firestore`; `asOf=2026-09-12T22:09:32.002Z`;
`warnings=[]`; `nextCursor=null`. O conector ficou conectado e a conversa aberta.
Nenhuma leitura de dados comerciais ou escrita foi solicitada neste teste.

Esta prova valida a reconexão do conector de homologação e a entrada compartilhada
em produção. Não representa novo teste autenticado de uma conta real de produção,
nem migração do banco operacional. Antes de um novo deploy da branch de migração,
ela deve incorporar esta correção de main.

Roteiro de aplicação e rollback:
[consent-routing](../../../supabase/hosted/consent-routing/README.md).
