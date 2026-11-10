# Adoção do Vibe Coding Toolkit

Esta configuração usa o [prompt 12 para projetos existentes](https://github.com/soumatheusgomes/vibe-coding-toolkit/blob/7ef68dd7b00ddfc5cd464458855e4ab66dd2128f/docs/prompts/12-existing-project-setup.md) na revisão `7ef68dd7b00ddfc5cd464458855e4ab66dd2128f`. A base foi o commit de organização `e0c85cd`. A aplicação usa Next.js 15.5.9, React 18 e npm com Node.js 22.

| Área do toolkit | Aplicação no BR Steel |
| --- | --- |
| Contexto do projeto | [README](../README.md) para visão do produto, [AGENTS](../AGENTS.md) para regras, [guia local](desenvolvimento-local.md) para onboarding, [arquitetura](arquitetura.md) para fronteiras e [qualidade](qualidade.md) para verificações. O tema e a UI têm como referência [components.json](../components.json) e [globals.css](../src/app/globals.css). |
| Claude Code e Codex | [CLAUDE.md](../CLAUDE.md) importa as mesmas regras do AGENTS. O arquivo foi conferido com a documentação oficial de imports. A descoberta pelo Claude precisa ser confirmada em uma nova sessão do cliente. |
| Processo e comunicação | Superpowers, trabalho proporcional à tarefa e revisão independente conforme risco. RTK 0.51.0 foi detectado na máquina. |
| Lint | ESLint 10.14.0 com os plugins de Next.js, TypeScript e React Hooks. O preset completo do Next.js 15 declara suporte até ESLint 9, cuja manutenção terminou. A primeira adoção usa os erros medidos como baseline e mantém o CI existente de tipos e testes. |
| Graphify | Reutiliza a CLI 0.9.92 com exclusões locais. A extração estrutural e uma consulta foram verificadas. O grafo gerado fica fora do Git. |
| Memória e handoff | Use documentos versionados e os planos de Superpowers como fonte de contexto do projeto. Obsidian, sistemas externos de memória e hooks ficam reservados para necessidades específicas. |
| Referências e skills | Use a documentação oficial quando Context7 estiver indisponível. As skills de Vercel, Supabase e artefatos são carregadas pelo cliente quando aplicáveis. O shadcn já está configurado no repositório. |
| Navegador e Next.js | Use o navegador do Codex para validar fluxos locais quando uma tarefa mexer na interface. Use análise de bundle e DevTools em tarefas de desempenho que precisem dessas ferramentas. |
| Diagnóstico e revisão | GitHub CLI é o caminho para consultar checks. Revisão de segurança, análise de SQL e diagnóstico do Sentry entram quando há escopo e ambiente definidos. |
| Avaliação do harness | O [guia de qualidade](qualidade.md) registra a adaptação nativa do método inspirado no Harness2. A validação inicial cobre lint e a consulta ao grafo. O CLI oficial e os benchmarks pertencem a um laboratório separado. |

## Atualizar o grafo local

Rode na raiz após mudanças de código relevantes. O comando indexa arquivos de código com análise estrutural local. Confirme relações importantes no código-fonte.

```sh
GRAPHIFY_NO_AUTO_REFRESH=1 graphify extract . --code-only --no-cluster
GRAPHIFY_NO_AUTO_REFRESH=1 graphify query "readOperationalSource"
```

Na primeira execução, 495 arquivos entraram na extração e 35 não produziram símbolos. A consulta retornou `src/server/persistence/source.ts` e o teste de integração do seletor. [Exclusões](../.graphifyignore) · [Guia do toolkit](https://github.com/soumatheusgomes/vibe-coding-toolkit/blob/7ef68dd7b00ddfc5cd464458855e4ab66dd2128f/docs/tools/07-graphify.md)

## Verificação local

A instalação limpa com `npm ci` passou. O lint analisou 461 arquivos com 28 avisos e zero erros fora da baseline. Em cópias de teste, o ESLint recusou tanto uma violação em arquivo novo quanto uma ocorrência acima da contagem em arquivo legado. O typecheck manteve os 25 diagnósticos já registrados.

Passaram 361 testes com Firestore emulado e 47 de integração PostgreSQL. O build compilou com a configuração sintética de `.env.example` e o Firestore emulado. A execução do workflow no GitHub depende da publicação da branch. [Configuração do CI](../.github/workflows/ci.yml)
