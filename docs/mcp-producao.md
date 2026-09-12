# MCP de leitura em produção

Publicado e habilitado em 12/09/2026 UTC, conforme autorização do usuário. O conector usa os usuários, as permissões e o banco operacional do BR Steel. A conexão pelo Claude pessoal em produção ainda aguarda validação do usuário. Escrita MCP permanece desabilitada.

## Destinos e versão

| Recurso | Destino |
| --- | --- |
| Aplicação | https://br-steel.vercel.app |
| Endpoint para cadastrar no Claude | https://br-steel.vercel.app/api/mcp |
| Projeto Vercel | `prj_nKDQAAfkgJ7DePQsIZy5gMELWuWj`, Node 22.x |
| Publicação ativa | `dpl_25QP3Q2cjkbABU45pB3tKJbMUhA5`, código `7f8c9a5` |
| Banco operacional | Firestore `(default)`, projeto `marketflow-9h4tg`, região `nam5` |
| Autenticação OAuth | Supabase `mlumbvxpaqfzpdjnvzxc` |

O servidor MCP roda na aplicação Vercel. O Supabase emite os tokens OAuth; os dados de negócio e as permissões continuam no Firestore. As ferramentas MCP de estoque e demanda consultam somente os registros persistidos, sem Bling ao vivo nem seu cache. A tela web de estoque mantém seu comportamento existente com fontes combinadas.

## Publicação realizada

O banco inicialmente recusava consultas com `Quota exceeded` e faturamento desabilitado. Após o usuário escolher explicitamente a conta terminada em `7132D4`, somente `marketflow-9h4tg` foi vinculado; a leitura voltou a funcionar. Outros projetos e a antiga conta encerrada não foram alterados.

O inventário encontrou 5 usuários, 12.521 pedidos, 361 observações de estoque e 3 lotes. Os 54 documentos de `supplies` incluem configurações de limites por SKU e formatos antigos; não equivalem a 54 cadastros completos. As permissões personalizadas existentes foram preservadas.

A aplicação com autenticação e consumidores web migrados entrou primeiro, com MCP/OAuth desligados. O usuário efetuou login real e foram verificadas as telas de vendas, estoque, Kanban e demanda. Depois foram publicadas as regras restritas: oito caminhos sensíveis recusaram leitura anônima com HTTP 403. Os 11 índices compostos estão prontos, preservando os dois existentes; TTL está ativo para auditoria e limites de requisição MCP.

A verificação real detectou uma falha em insumos: documentos de configuração sem nome chegavam à ordenação do cadastro. A correção preserva a seleção de registros nomeados do leitor anterior, mantém a paginação e apresenta campos ausentes como “Não informado”. Nenhum documento foi corrigido, apagado ou preenchido automaticamente. Cadastro e estoque de insumos foram verificados no navegador com a sessão legítima do usuário após a publicação final.

O hook privado do Supabase foi atualizado e suas asserções remotas passaram. Proprietário e permissões ficaram idênticos; `private` continua fora da Data API. Site URL aponta para produção e os dois retornos exatos de consentimento, produção e homologação, estão cadastrados. O hook mantém a audiência legada do piloto; seu refresh real após a alteração ainda não foi observado. A conexão piloto não foi revogada.

Os três crons e os segredos das integrações existentes foram preservados. Os novos segredos exclusivos de sessão/cron foram configurados na primeira publicação; o usuário já entrou novamente sem alteração de sua senha. O segredo temporário que a CLI Vercel criou para testar a publicação protegida foi revogado após as verificações.

## Acesso e ferramentas

`MCP_ENABLED=true`, `MCP_OAUTH_ENABLED=true`, `MCP_WRITES_ENABLED=false` e `MCP_USER_ACCESS_MODE=authenticated`.

O modo authenticated dispensa a lista manual de pilotos. Cada chamada continua verificando identidade OAuth, assinatura, audiência, cliente, concessão, versão da autenticação, usuário ativo, papel e permissões atuais. O consentimento não amplia o acesso além do permitido no sistema. Contas com senha inicial precisam concluir sua troca pessoal antes de autorizar o Claude.

Há 12 ferramentas de leitura, filtradas pelo acesso efetivo: consultar acesso, listar/detalhar/resumir pedidos, estoque de produtos, insumos e movimentações, demanda/pedidos de produção, colunas/lotes/detalhes do Kanban. Não há ferramenta MCP de escrita publicada.

## Verificação e próximo teste

A suíte passou com 160 testes em 27 arquivos. Os builds local e Vercel passaram; a checagem TypeScript manteve exatamente os 25 diagnósticos preexistentes, sem novos erros. Revisão independente aprovada. O validador de configuração confirmou o destino e a fase de leitura; os 414 arquivos regulares enviados foram examinados sem correspondência de valores privados.

No domínio canônico, login e metadados respondem 200; MCP sem token responde 401 com o endereço correto de descoberta. APIs de sessão, vendas, insumos e cron recusam acesso anônimo. O Supabase apresentou somente o aviso de proteção contra senhas vazadas desativada; o fluxo usa login próprio BR Steel e não solicita senha Supabase do usuário. Nenhum problema de banco/função foi indicado pelos advisors.

Para a aceitação de produção:

1. Cadastrar `https://br-steel.vercel.app/api/mcp` no Claude e autenticar com o usuário real do BR Steel.
2. Consultar o próprio acesso e os três indicadores. A referência verificada para 01/09 a 11/09/2026 é 466 pedidos, R$ 215.757,67; havia 361 observações válidas de estoque. Os dados podem mudar com a sincronização normal.
3. Conferir permissões, código/refresh legítimos, revogação e reconexão. Esses passos ainda não foram comprovados pelo Claude em produção; as asserções SQL não substituem a emissão real.

Evidências: `docs/evidence/mcp-production-readonly-2026-09-12.json` e o registro histórico `docs/evidence/mcp-production-phase1-2026-09-12.json`. O checkpoint de preparação permanece como histórico, sem representar o estado atual.

As alterações estão na branch local `codex/mcp-auth-foundation`. Não houve push/merge no GitHub nem alteração da branch principal. A integração futura deve incluir a autenticação e os consumidores web migrados, além da rota MCP.

## Reversão

Desabilitar MCP/OAuth antes de desfazer a configuração do provedor. Preservar backups privados e comparar mudanças posteriores; instruções SQL em `supabase/hosted/production/README.md`. Alterar o hook não revoga tokens já emitidos.

Depois do fechamento das regras, não restaurar o frontend antigo isoladamente: seus leitores diretos deixarão de funcionar. Corrigir mantendo as regras protegidas ou preparar uma reversão coordenada. Os backups não autorizam reabrir automaticamente coleções sensíveis.
