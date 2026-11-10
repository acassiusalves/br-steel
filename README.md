# BR Steel

Sistema web para acompanhar vendas, estoque, produção, insumos, produtos e conciliação financeira, com integrações Bling e Mercado Livre. O aplicativo usa Next.js, React e TypeScript. O núcleo operacional tem persistência em Firestore e PostgreSQL por meio de repositórios selecionados em execução. O MCP de leitura usa OAuth.

## Começar a desenvolver

Use Node.js 22, Java 21 e Firebase CLI 14.11.1. O [guia de desenvolvimento local](docs/desenvolvimento-local.md) mostra como instalar as dependências, iniciar o Firestore emulado, carregar dados fictícios e abrir o aplicativo na porta 9003. Use o guia também em um checkout que já tenha configuração de Firebase.

| Comando | Verificação |
| --- | --- |
| `npm run typecheck:ci` | Compara os diagnósticos TypeScript com a baseline do CI. |
| `npm run test:vitest` | Roda a suíte com o Firestore emulado. |
| `npm run test:postgres` | Roda a integração em PostgreSQL descartável, com Docker e Firestore emulado. |

O comando `npm run typecheck` mostra todos os diagnósticos, inclusive os já registrados na baseline. O script `npm run lint` ainda abre o configurador de ESLint.

## Estrutura do projeto

| Pasta | Conteúdo |
| --- | --- |
| [`src/app/`](src/app/) | Páginas, rotas de API, callbacks, webhooks e crons. |
| [`src/components/`](src/components/) | Componentes de tela e primitivas compartilhadas. |
| [`src/server/`](src/server/) | Autorização, operações de negócio, OAuth/MCP e persistência. |
| [`src/services/`](src/services/) e [`src/ai/`](src/ai/) | Adaptadores, integrações e fluxos de IA. |
| [`tests/`](tests/) | Suítes por domínio, integração PostgreSQL e fixtures. |
| [`supabase/`](supabase/) | Trilhas separadas de OAuth e banco operacional. |
| [`docs/`](docs/README.md) | Guias, procedimentos e histórico. |
| [`scripts/`](scripts/README.md) | Catálogo de utilitários locais, verificações e rotinas operacionais. |

Leia as [regras do projeto](AGENTS.md) antes de alterar código, dados ou documentação. Abra PR contra `main` com o escopo e as verificações executadas. O [CI](.github/workflows/ci.yml) verifica tipos, Vitest e integração PostgreSQL.
