# Qualidade e revisão

Use os comandos da raiz do projeto. O [CI](../.github/workflows/ci.yml) roda lint, typecheck, Vitest com Firestore emulado e integração PostgreSQL. O [guia local](desenvolvimento-local.md) traz os pré-requisitos das suítes.

| Verificação | Comando | Cobertura |
| --- | --- | --- |
| Lint | `npm run lint` | Regras de Next.js, TypeScript e React Hooks em `src/`, além de verificações de código em `scripts/` e `tests/`. |
| Tipos | `npm run typecheck:ci` | Compara os diagnósticos TypeScript com a baseline do CI. |
| Comportamento | `npm run test:vitest` | Serviços, rotas, regras do Firestore, OAuth e MCP com fixtures. |
| Integração | `npm run test:postgres` | Executa os testes de PostgreSQL e Firestore em ambiente descartável. |
| Build | `npm run build` | Valida a compilação. O build atual deixa lint e typecheck a cargo de comandos próprios. |

## Baseline de lint

A primeira medição encontrou 875 erros em 84 arquivos e 28 avisos. O [arquivo de supressões](../eslint-suppressions.json) registra somente os erros legados por arquivo e regra. O CI falha quando surge um erro fora da baseline ou quando a contagem de um arquivo e regra supera a registrada no JSON. Avisos de Hooks e Next.js continuam visíveis para revisão.

Ao corrigir erros legados ou remover arquivos com supressões, rode `npm run lint -- --prune-suppressions` na suíte de lint completa e revise as entradas removidas. Revise explicitamente qualquer aumento de baseline no PR. Mantenha o limite de tamanho de arquivos como indicador para orientar refatorações por responsabilidade. [Supressões do ESLint](https://eslint.org/docs/latest/use/suppressions)

## Revisão e evidências

Antes de mudar um contrato, confirme seus chamadores, o comportamento atual e o teste que comprovará a mudança. Para alterações de maior risco, faça revisão independente do diff e verifique autenticação, autorização, efeitos externos e recuperação conforme o escopo. Registre no PR os comandos, resultados e limites das verificações.

Para investigar uma falha recorrente das instruções ou ferramentas, use o método nativo descrito no [prompt 15](https://github.com/soumatheusgomes/vibe-coding-toolkit/blob/7ef68dd7b00ddfc5cd464458855e4ab66dd2128f/docs/prompts/15-harness-improvement.md). Reproduza em cópia descartável, compare uma mudança com os mesmos critérios e use o diff e os resultados observados como evidência.
