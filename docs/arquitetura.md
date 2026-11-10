# Arquitetura do BR Steel

O Next.js organiza páginas e endpoints em [`src/app/`](../src/app/). Os componentes de uso comum ficam em [`src/components/`](../src/components/), com primitivas shadcn em [`src/components/ui/`](../src/components/ui/). A [configuração do shadcn](../components.json) e o [CSS global](../src/app/globals.css) registram os pontos de extensão do tema.

| Área | Onde começa | Fronteira |
| --- | --- | --- |
| Operação web | [`src/app/api/operations/`](../src/app/api/operations/) | O servidor deriva identidade e permissões da sessão em [`src/server/access/`](../src/server/access/) e executa regras em [`src/server/operations/`](../src/server/operations/). |
| Dados operacionais | [`src/server/persistence/`](../src/server/persistence/) | Os contratos escolhem Firestore ou PostgreSQL em execução. O [seletor](../src/server/persistence/source.ts) descreve como a fonte é resolvida. |
| MCP | [`src/app/api/mcp/`](../src/app/api/mcp/) | As ferramentas de leitura e a autorização ficam em [`src/server/mcp/`](../src/server/mcp/) e [`src/server/oauth/`](../src/server/oauth/). |
| Integrações externas | [`src/services/`](../src/services/) e [`src/server/integrations/`](../src/server/integrations/) | Chamadas e credenciais devem respeitar a fronteira entre cliente e servidor. Callbacks, webhooks e crons têm contratos de URL próprios. |

Os procedimentos de Firebase, OAuth e PostgreSQL ficam no [índice da documentação](README.md). Use a trilha do ambiente e da operação que vai alterar.
