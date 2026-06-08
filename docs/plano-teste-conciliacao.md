# Plano de Teste — Página Conciliação (br-steel)

**Contexto para o agente testador:** a página `/financeiro/conciliacao` foi portada do sistema faturamentto-clientes e acabou de passar por refatoração estrutural (decomposição de componentes, separação client/server no service, bloqueio das rules do Firestore). O código compila limpo (`tsc` e Turbopack). O objetivo agora é validar o **comportamento funcional** ponta a ponta. Nenhuma mudança de lógica foi intencional — qualquer comportamento quebrado é regressão da refatoração ou lacuna da cópia original.

**Arquivos sob teste:**
- `src/app/financeiro/conciliacao/ConciliacaoClient.tsx` (orquestração)
- `src/app/financeiro/conciliacao/components/{shared,settings-dialogs,payouts,OrderDetailsDialog}.tsx`
- `src/services/conciliation-service.ts` + `src/lib/conciliation/orders.ts`
- `src/app/api/financeiro/conciliacao/route.ts`

---

## Pré-requisitos

1. `npm run dev` rodando (porta 9003).
2. Login no app com usuário **Administrador** (a rota é restrita a Admin em `src/lib/permissions.ts`).
3. Deve haver pedidos na coleção `salesOrders` do Firestore (a página é alimentada por eles em tempo real).
4. DevTools aberto com aba Console visível durante TODOS os testes — qualquer erro/warning vermelho deve ser anotado com o passo que o causou.
5. Para o teste 9, criar uma planilha XLSX de repasses com as colunas: `Pedido`, `Data Repasse`, `Valor Bruto`, `Taxa`, `Frete`, `Valor Líquido` — usar números de pedido reais visíveis na tabela (coluna nº pedido / nº loja), 3 a 5 linhas, sendo pelo menos 1 com valor líquido igual ao do pedido e 1 com valor divergente.

---

## Roteiro de testes

Para cada item, registrar: **OK / FALHA / BLOQUEADO** + observação (e print se FALHA).

### 1. Carregamento e permissões
1.1. Acessar `/financeiro/conciliacao` logado como Admin → página carrega, skeleton de loading aparece e some, tabela popula com pedidos.
1.2. Acessar `/conciliacao` → redireciona para `/financeiro/conciliacao`.
1.3. (Se houver usuário não-Admin disponível) acessar a rota → acesso negado/redirect.
1.4. Cards de KPI no topo exibem valores coerentes (faturamento bruto/líquido, custo, margem, % conciliado etc.) — comparar a ordem de grandeza com os pedidos visíveis.

### 2. Filtros
2.1. Filtro de período: testar os atalhos (hoje, 7 dias, mês atual, mês anterior) e um intervalo manual no calendário → tabela e KPIs atualizam.
2.2. Filtro de marketplace → restringe linhas ao marketplace escolhido.
2.3. Busca textual: buscar por nº de pedido, nome de cliente e SKU → encontra; buscar texto inexistente → estado vazio amigável.
2.4. Filtros de status do sistema, status de conciliação (Pendentes/Conciliados), alerta financeiro, ajustes, repasse e sugestões → cada um filtra corretamente e os contadores/KPIs acompanham.
2.5. Combinar 2+ filtros simultâneos → resultado é a interseção; limpar filtros restaura tudo.

### 3. Tabela
3.1. Ordenar por 3+ colunas diferentes (data, valor bruto, cliente) asc/desc → ordem correta (atenção a ordenação numérica vs alfabética).
3.2. Reordenar colunas por drag-and-drop → ordem muda e **persiste após F5** (localStorage).
3.3. Mostrar/ocultar colunas no popover de visibilidade → persiste após F5.
3.4. Alternar densidade (compacta/confortável) e modo tabela/cards → ambos funcionam e persistem após F5.
3.5. Paginação: trocar linhas por página (20/50/100), navegar primeira/anterior/próxima/última → contadores corretos.

### 4. Conciliação (fluxo principal)
4.1. Selecionar 1 pedido (checkbox) e marcar como conciliado → badge/status muda, KPI de % conciliado atualiza.
4.2. **F5 na página** → o pedido continua conciliado (persistência via API/Firestore).
4.3. Desconciliar o mesmo pedido → volta a pendente e persiste após F5.
4.4. Seleção em lote: selecionar vários (e "selecionar todos da página") → conciliar em lote → todos mudam; desconciliar em lote.
4.5. Conferir no modal de detalhes do pedido conciliado se há registro de auditoria (quem/quando).

### 5. Status do sistema
5.1. No select inline da linha, trocar o status manual de um pedido (ex.: para "Devolução") → cor/badge muda, persiste após F5.
5.2. Voltar para "Automático" → status recalculado a partir da situação do pedido.
5.3. Abrir o dialog de mapeamento de status, mapear um status do ERP para um status do sistema → pedidos com aquele status mudam em massa; persiste após F5.

### 6. Modal de detalhes do pedido
6.1. Clicar num pedido → modal abre com todas as abas/seções (geral, cliente, itens, financeiro).
6.2. Conferir consistência: itens, quantidades, valores e totais batem com a linha da tabela.
6.3. Ajustes financeiros: ativar ajuste num campo (ex.: comissão), inserir novo valor e motivo, salvar → líquido e margem recalculam na tabela, badge de ajuste aparece na linha, persiste após F5.
6.4. Remover/desativar o ajuste → valores originais voltam.

### 7. Colunas calculadas
7.1. Abrir configurações de cálculos, criar cálculo simples (ex.: `valorBruto * 0.1`) → validação aceita, coluna nova aparece na tabela com valores corretos.
7.2. Tentar fórmula inválida (ex.: referência circular ou campo inexistente) → erro de validação claro, não salva.
7.3. Excluir o cálculo → coluna some; persiste após F5.

### 8. Regras de divergência financeira
8.1. Abrir configurações de alertas/divergências, alterar um limite (ex.: margem mínima) → badges de alerta nas linhas e KPI de alertas atualizam.
8.2. Restaurar padrão → comportamento volta.

### 9. Importação de repasses (XLSX)
9.1. Abrir dialog de importação de repasses, fazer upload da planilha de teste → preview com mapeamento automático das colunas; ajustar mapeamento manualmente se necessário.
9.2. Confirmar importação → pedidos correspondentes ganham status de repasse: "Repasse OK" para o de valor igual, "Divergente" para o de valor diferente, "Sem repasse" para os demais.
9.3. Abrir histórico de repasses → importação listada com arquivo/data/linhas.
9.4. Desfazer a importação pelo histórico → status de repasse dos pedidos volta a "Sem repasse"; persiste após F5.

### 10. Configuração do resumo (KPIs)
10.1. Abrir configurações do resumo, desmarcar/marcar métricas → cards somem/aparecem; persiste após F5.

### 11. Export XLSX
11.1. Exportar a tabela → arquivo baixa, abre no Excel/LibreOffice, colunas correspondem às visíveis na tela e valores batem.
11.2. Exportar com filtro ativo → só as linhas filtradas saem no arquivo.

### 12. Tempo real
12.1. (Se viável) Alterar um pedido em `salesOrders` no console do Firebase → a tabela reflete a mudança sem F5 (listener `onSnapshot`).

---

## Formato do relatório esperado

```
# Relatório de Teste — Conciliação br-steel
Data/hora:
Ambiente: (navegador, porta, usuário)

## Resumo
- Total: X testes | OK: X | FALHA: X | BLOQUEADO: X

## Falhas (detalhar cada uma)
- [nº do teste] O que foi feito / o que era esperado / o que ocorreu
- Erros de console relacionados (mensagem completa + stack)
- Print/screenshot

## Erros de console não associados a falha funcional
- (lista)

## Observações de UX/performance
- (lentidão, travamentos, layout quebrado, textos errados)
```

**Importante para o testador:**
- Não corrigir nada — apenas reportar.
- Cada teste de persistência exige F5 real (não apenas re-render).
- Se um teste bloquear os seguintes (ex.: página não carrega), marcar os dependentes como BLOQUEADO e seguir para os independentes.
