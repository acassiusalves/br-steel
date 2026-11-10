# Regras do BR Steel

## Antes de mudar o projeto

- Leia o [README](README.md), o [índice de documentação](docs/README.md) e o guia da área que será alterada.
- Use uma branch de trabalho e abra PR contra `main`. Descreva o que mudou, o que foi verificado e quais ambientes ou integrações o diff afeta.
- Trate planos e evidências datados como registros históricos. Use o código e a configuração versionada para confirmar o comportamento atual.

## Onde colocar código

- Em `src/app/`, mantenha as entradas de páginas e rotas do Next.js. Coloque componentes exclusivos de uma tela junto da rota quando possível. Use `src/components/ui/` para primitivas compartilhadas.
- Em `src/server/access/` e `src/server/operations/`, concentre autorização e operações de negócio protegidas. Derive identidade e permissões da sessão no servidor.
- Em `src/server/persistence/`, preserve os contratos e a seleção de fonte entre Firestore e PostgreSQL. Passe pelo repositório da operação quando alterar o núcleo operacional.
- Preserve URLs públicas, redirecionamentos, callbacks, webhooks, crons e contratos OAuth/MCP quando a tarefa não exigir mudança nesses pontos.
- Use os diretórios existentes em `tests/` conforme o domínio. A integração PostgreSQL tem executor separado do Vitest.

## Ambientes e dados

- Para desenvolvimento e testes, siga o [guia local](docs/desenvolvimento-local.md) com emulador e dados sintéticos. Confirme o projeto e o host antes de semear ou limpar dados.
- Revise o [catálogo de scripts](scripts/README.md) antes de executar verificações externas, rotinas de integração ou manutenção. Deploy, migração, backfill e ações em ambiente compartilhado exigem escopo autorizado e destino explícito.
- Preserve a separação entre as migrations de OAuth local, as rotinas de OAuth hospedado e a cadeia SQL operacional. Cada trilha tem seu próprio procedimento no [índice de documentação](docs/README.md).
- Mantenha credenciais, dados pessoais, dumps e snapshots privados fora do Git e dos artefatos de CI. O repositório é público. Use valores sintéticos nos exemplos e revise o diff antes de publicar.

## Validação

- Use Node.js 22. Para reproduzir o CI, use Java 21, Firebase CLI 14.11.1 e Docker para a suíte PostgreSQL.
- Rode `npm run typecheck:ci` e a suíte aplicável. Preserve a baseline de tipos ou reduza-a junto da correção correspondente. O build atual ignora erros de tipo e lint.
- Confira os links e os comandos ao alterar documentação. Para um fluxo de setup novo, valide-o em checkout limpo com o emulador.
