# Chamados de erros e melhorias (cópia do Calculaqui)

Data: 13/11/2026. Origem: tela de reportes do Calculaqui (`AdminReportsPage`, `MyReportsPage`, `ReportsPageView`,
`FloatingReportButton`, `ReportContext` e as funções `createErrorReport`, `listErrorReports`,
`updateErrorReportStatus` e `reopenErrorReport`).

Objetivo: registrar erros e melhorias pelo próprio sistema e deixar quem reportou acompanhar a resolução. A primeira
utilização é a reunião com a equipe da fábrica.

## Como funciona no Calculaqui

- **Botão flutuante "Problemas?"** em todas as telas logadas. Ele abre o modal "Reportar problema ou melhoria", com
  tipo (Erro ou Melhoria), descrição com ditado por voz e o aviso de que o envio inclui página atual, navegador,
  versão, erros recentes e últimos cliques.
- **Captura automática.** Na sessão, o sistema guarda os últimos 25 erros (`console.error`, `window.onerror`,
  promessas rejeitadas, falhas de `fetch`) e os últimos 80 passos (cliques, envios de formulário, falhas HTTP, troca
  de página). No envio, junta o ambiente: URL, caminho, navegador, resolução, fuso, idioma, build e sessão.
- **Número do chamado.** Cada chamado recebe um número sequencial `#N`, mostrado em destaque na confirmação com o
  texto "Anote este número...".
- **Impressão digital (fingerprint).** É o SHA-256 de tipo, página, primeira mensagem de erro (ou o início da
  descrição) e primeira linha do stack. Agrupa repetições do mesmo erro.
- **Situações.** Pendente, Em análise e Resolvido. Só o administrador muda a situação: "Marcar em análise",
  "Concluir" e "Reabrir como admin".
- **Reabertura.** Só o autor reabre, e só quando o chamado está resolvido. Ele explica o que falta, o chamado volta a
  Pendente e entra no histórico "Reaberturas".
- **Telas.** "Reportes" (administrador, todos os chamados, com a coluna Usuário) e "Meus reportes" (cada usuário vê
  só os seus). As duas usam a mesma visão:
  - quatro contadores (Total, Pendentes, Em análise, Resolvidos);
  - busca por descrição, usuário, página, fingerprint ou número;
  - filtros de situação e de tipo;
  - tabela paginada;
  - modal de detalhes com descrição, reaberturas, ambiente, linha do tempo da sessão, contexto da página e logs.
- **Limites.**
  - No máximo 5 envios a cada 10 minutos por usuário.
  - Cada lista traz até 250 chamados.

## Adaptação ao BR Steel

- **Persistência só no Supabase (PostgreSQL).** O schema novo `brsteel_support` tem a tabela `tickets`, criada pela
  migration `20261113150000_support_tickets.sql`:
  - o número vem de uma coluna identity;
  - `resolved_at` é mantido por gatilho, como no Calculaqui;
  - as permissões e políticas de RLS seguem os papéis `brsteel_ops_writer`, `brsteel_ops_reader` e
    `brsteel_ops_backup`.
- **Camadas.** As camadas são as do projeto:
  - repositório só PostgreSQL (`postgresOnlyRepository`);
  - escrita via `withOperationalWrite`, com auditoria em `brsteel_write.audit`;
  - operações em `src/server/operations/support-tickets.ts`;
  - rota `/api/operations/support-tickets`.
- **Acesso.**
  - "Meus reportes" (`/meus-reportes`) é para todos os papéis. Quem pode abri-la vê o botão flutuante e envia
    chamados.
  - "Reportes" (`/reportes`) é só do Administrador, que muda a situação.
  - A identidade (id, nome e e-mail) vem da sessão, no servidor.
- **Navegação.** "Reportes" entra no grupo Configurações. "Meus reportes" entra no menu da conta, como no Calculaqui.
- **Limite de envio.** O Administrador não tem limite, porque vai registrar vários chamados seguidos na reunião. Os
  demais papéis seguem com 5 envios a cada 10 minutos.
- **Captura no cliente.** Um módulo único (`src/lib/report-capture.ts`), instalado pelo layout logado, sobrevive à
  navegação entre páginas.

## Fora desta entrega

- O link "Ver o que mudou" ligado ao changelog: o BR Steel não tem changelog.
- O aviso no sino quando um chamado é resolvido: o acompanhamento fica em "Meus reportes".
- O registro em nome de outro usuário: na reunião, os chamados ficam no nome de quem registra.
- A inclusão de `brsteel_support` no backup operacional: as listas do backup mudam junto com o PR do PCP e serão
  ajustadas depois dos dois merges.

## Verificação

- Testes de operação no Vitest:
  - validação;
  - escopo admin e "meus";
  - reabertura só pelo autor e só quando resolvido;
  - limite de envio;
  - fingerprint.
- No navegador, com o banco local:
  - enviar pelo botão;
  - ver em "Meus reportes";
  - mudar a situação como administrador;
  - reabrir como autor.
- Aplicar a migration no Supabase hospedado.
