# Plano de Reteste — Página Conciliação (br-steel) — Rodada 2

**Contexto para o agente testador:** após a rodada 1, foram corrigidos 4 bugs e 2 falhas foram diagnosticadas como falso positivo. Este reteste valida as correções, repete os 2 testes inconclusivos e cobre itens que ficaram bloqueados. Use o relatório no mesmo formato da rodada 1.

**Pré-requisitos:**
1. Reiniciar o dev server (`npm run dev`, porta 9003) para garantir código novo.
2. Login como Administrador.
3. Antes de começar, fazer um hard refresh (Ctrl+Shift+R) em `/financeiro/conciliacao`.
4. Console do DevTools aberto durante todos os testes; anotar qualquer erro.

---

## Bloco A — Validar correções da rodada 1

### A1. Persistência da consulta após F5 (corrige falha 1.1)
1. Aplicar uma consulta: escolher período "Mês Atual", marketplace "Todos", clicar **Aplicar** → tabela carrega.
2. Pressionar **F5 (reload real)**.
3. **Esperado:** a tabela volta carregada com o MESMO período/filtros, sem precisar clicar Aplicar de novo. Os campos de filtro mostram os valores aplicados.
4. Mudar o marketplace para um específico, aplicar, F5 → o marketplace escolhido deve permanecer.
5. Repetir agora os antigos 3.3/3.4: ocultar uma coluna, mudar densidade para "Compacta", F5 → tudo persiste junto com a consulta.

### A2. Select inline de status do sistema (corrige falha 5.1)
1. Verificar que a coluna **"Status do Sistema"** (ou similar) agora aparece por padrão na tabela.
2. Na própria linha (sem abrir modal), usar o select inline para trocar o status de um pedido para "Devolução".
3. **Esperado:** badge/cor muda na hora; F5 → status manual persiste.
4. Voltar para "Automático" pelo mesmo select inline → status recalculado.

### A3. Cards de KPI configuráveis (corrige falha 10.1)
1. Abrir **Configurar Resumo**.
2. Ativar uma métrica que não está visível (ex.: "Margem %" / "Ticket Médio") e desativar outra que está.
3. Salvar.
4. **Esperado:** os cards refletem exatamente as métricas marcadas (a ativada aparece, a desativada some). O card "Taxa de Afiliados" é fixo e sempre aparece — não é falha.
5. F5 → a configuração de cards persiste.

### A4. Erro de console "unauthorized" (correção 11)
1. Durante toda a sessão de teste, observar o console.
2. **Esperado:** sem erro `Erro ao carregar sidecar de conciliacao: unauthorized`. Se aparecer uma única vez seguida de carregamento normal (retry automático), anotar como observação, não como falha.

---

## Bloco B — Reteste dos inconclusivos (3.1 e 3.2)

**Instrução importante:** os handlers de ordenação e movimentação estão corretos no código. Na rodada 1 os cliques podem não ter registrado. Desta vez:

### B1. Ordenação (reteste 3.1)
1. Clicar EXATAMENTE no texto do cabeçalho "Faturamento Bruto" (é um botão; o cursor vira pointer e aparece ícone de seta ao lado do texto).
2. **Esperado 1º clique:** ordem crescente (menor valor primeiro) + ícone de seta para cima + toast rápido "Ordenando pedidos...".
3. **Esperado 2º clique:** ordem decrescente.
4. Conferir com 3 valores visíveis se a ordem é numérica correta (ex.: 44,89 < 338,54 < 435,54).
5. Repetir com a coluna "Data" e "Cliente".
6. Se o clique não surtir efeito, anotar: o ícone de seta mudou? o toast apareceu? algum erro no console?

### B2. Reordenação de colunas (reteste 3.2)
1. Passar o mouse sobre o cabeçalho da coluna "Pedido" → aparecem setas ‹ › pequenas acima do título.
2. Clicar na seta **›** (mover para a direita) — mais confiável que drag para teste automatizado.
3. **Esperado:** coluna troca de posição + aviso "Coluna movida"; F5 → nova ordem persiste.
4. Testar também o drag-and-drop do cabeçalho (arrastar "Pedido" sobre outra coluna). Se o drag falhar mas as setas funcionarem, anotar separadamente.

---

## Bloco C — Itens bloqueados na rodada 1 que o agente pode fazer

### C1. Mapeamento de status em massa (antigo 5.3)
1. Abrir "Configurar status" → dialog de mapeamento.
2. Mapear um status do ERP (ex.: o status mais comum na tabela) para um status do sistema diferente do automático.
3. Salvar → **Esperado:** todos os pedidos com aquele status mudam de uma vez; persiste após F5.
4. Remover o mapeamento ao final.

### C2. Regras de divergência (antigos 8.1/8.2)
1. Abrir configurações de alertas financeiros.
2. Alterar um limite de forma agressiva (ex.: margem mínima para 90%) → salvar.
3. **Esperado:** quase todos os pedidos ganham badge de alerta; KPI de alertas sobe.
4. Restaurar o padrão → badges voltam ao estado anterior.

### C3. Tempo real (antigo 12.1 — opcional)
Se houver acesso ao console do Firebase: alterar o campo de um pedido em `salesOrders` → a tabela deve refletir sem F5.

---

## Bloco D — Exige humano (NÃO executar pelo agente; deixar marcado como manual)

- **D1. Importação de repasses XLSX** (antigos 9.1–9.4) — browser do agente não suporta upload.
- **D2. Export XLSX** (antigos 11.1/11.2) — browser do agente não suporta download.

---

## Formato do relatório

Mesmo formato da rodada 1: resumo numérico, detalhes por falha (passos/esperado/ocorrido + erro de console + print), erros de console avulsos, observações de UX. Indicar explicitamente para cada item do Bloco A se a correção foi confirmada.
