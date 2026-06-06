# Analise da pagina de conciliacao do faturamentto-clientes

Data da analise: 2026-06-05

Referencia analisada:

- Sistema: `/Users/acassiusalves/faturamentto-clientes`
- Rota em execucao: `http://localhost:5500/conciliacao`
- Sistema alvo: `/Users/acassiusalves/br-steel`

## Resumo executivo

A pagina `/conciliacao` do sistema `faturamentto-clientes` nao e apenas uma tabela de pedidos. Ela e uma central operacional de conciliacao linha a linha, com:

- filtros de entrada por periodo e marketplace;
- carregamento pesado em lotes;
- normalizacao de pedidos Bling;
- enriquecimento com dados de marketplaces;
- associacao de planilhas de apoio;
- calculos customizados;
- status manual e automatico;
- conciliacao automatica;
- ajustes manuais por pedido;
- marcacao em massa como conciliado;
- snapshot do pedido no momento da conciliacao;
- configuracoes persistidas por empresa.

Recomendacao: nao tentar copiar a pagina inteira de uma vez. A migracao deve ser feita em fases, com uma primeira entrega somente leitura, usando o `salesOrders` atual do `br-steel` como fonte e criando uma camada de sidecar para as decisoes de conciliacao.

## O que foi observado na UI

Estado inicial da tela:

- Titulo: `Conciliacao de Vendas`.
- A tela nao carrega pedidos automaticamente.
- O usuario precisa selecionar periodo + marketplace e clicar em `Aplicar`.
- Enquanto nao aplica, aparece o alerta: consulta nao aplicada.
- Opcoes de marketplace visiveis no ambiente rodando: `Amazon` e `Shopee`.

Consulta testada:

- Periodo: `01/06/2026 - 05/06/2026`
- Marketplace: `Shopee`
- Resultado: `628 pedido(s)`.
- Paginacao: `20` itens por pagina, `32` paginas.
- Concilacao automatica indicou `145 pedido(s)` conciliados automaticamente.
- Progresso de conciliacao visivel ficou em `14%`.

Resumo observado:

- Faturamento Bruto: `R$ 108.022,88`
- Custo do Produto (CMV): `R$ 62.495,56`
- Margem de Contribuicao: `R$ 12.669,38`
- Taxa de Afiliados: `R$ 74,36`

Tabela observada:

- Titulo: `Detalhes das Vendas`.
- Controles: `Exportar`, alternancia `Cards`, `Exibir Colunas`.
- Visibilidade inicial: `12/49` colunas.
- Colunas visiveis na consulta Shopee:
  - Conciliação
  - Itens
  - Pedido
  - Data
  - Conta
  - Marketplace
  - Produto
  - Qtd
  - Status Pedido
  - Faturamento Bruto
  - Liquido
  - Imposto
  - Margem de Contribuicao
  - Margem %

Detalhe de pedido:

- Abre em modal ao clicar na linha.
- Abas observadas: Geral, Cliente, Itens, Financeiro, Calculado, Shopee, Sistema, Transporte, Observacoes, Devolucoes, Planilha.
- O modal atualiza detalhes do pedido ao abrir.
- Mostra alertas de qualidade de dados, por exemplo quando a transportadora vem da Shopee e nao do Bling.
- O botao `Salvar Alteracoes` fica desabilitado ate existir ajuste manual.

## Mapa de arquivos da referencia

### Rota e navegacao

Arquivo: `/Users/acassiusalves/faturamentto-clientes/src/App.tsx`

- Lazy import da pagina: `src/pages/Conciliacao`.
- Rota principal: `/conciliacao`.
- Rota complementar de planilhas: `/conciliacao/planilhas`.
- Rota de relatorio: `/relatorio-conciliacao`.
- No menu, a pagina fica dentro do grupo `Financeiro`.

### Pagina principal

Arquivo: `/Users/acassiusalves/faturamentto-clientes/src/pages/Conciliacao.tsx`

- Tamanho: `7501` linhas.
- Responsabilidades principais:
  - estado da consulta aplicada;
  - periodo, marketplace e busca global;
  - carregamento de vendas em lote;
  - carregamento de associacoes de planilhas;
  - resumo/KPIs;
  - filtros locais;
  - status manual/automatico;
  - reconciliacao em massa;
  - sincronizacao de marketplace;
  - configuracoes de calculo, resumo, conta, status e automacao;
  - exportacao XLSX;
  - abertura e salvamento do detalhe de pedido.

Este arquivo concentra muita regra. Para o `br-steel`, vale quebrar isso desde o inicio em hook/servico/componentes menores.

### Componentes principais

Arquivos da referencia:

- `src/components/conciliacao/ConciliacaoTable.tsx` - `2465` linhas.
- `src/components/conciliacao/SaleCard.tsx` - `337` linhas.
- `src/components/conciliacao/ConciliacaoSaleDetailsDialog.tsx` - `1615` linhas.
- `src/components/conciliacao/ConciliacaoSettingsDialog.tsx` - `318` linhas.
- `src/components/conciliacao/CalculationDialog.tsx` - `1516` linhas.
- `src/components/conciliacao/ConciliacaoCompactFilters.tsx` - `946` linhas.
- `src/components/conciliacao/ConciliacaoSummary.tsx` - `197` linhas.
- `src/components/conciliacao/ConciliacaoBatchActions.tsx` - `63` linhas.
- `src/components/conciliacao/SummaryConfigDialog.tsx` - `582` linhas.

### Servico principal

Arquivo: `/Users/acassiusalves/faturamentto-clientes/src/services/conciliacao.service.ts`

Responsabilidades:

- converter linhas do banco para `ConciliationSale`;
- buscar pedidos conciliaveis por periodo/filtros;
- fazer lookup global de pedido;
- carregar detalhes de uma venda;
- carregar associacoes de planilha;
- carregar/salvar ajustes manuais;
- carregar/salvar configuracoes;
- carregar/salvar configuracao do resumo;
- marcar pedidos como conciliados;
- carregar breakdowns de status e marketplaces;
- hidratar dados externos: Mercado Livre, Mercado Pago, Shopee, custo de produto, devolucoes operacionais.

### Tipos principais

Arquivo: `/Users/acassiusalves/faturamentto-clientes/src/types/conciliacao.ts`

Tipos centrais:

- `ConciliationSale`
- `ConciliationSaleItem`
- `ConciliationAssociation`
- `ConciliationSaleAdjustment`
- `ConciliationReconciledSaleSnapshotInput`
- `CustomCalculation`
- `FormulaItem`
- `SummaryConfig`
- `SystemStatusConfig`
- `StatusColumnMappingsConfig`
- `AutoReconciliationConfig`

## Modelo conceitual da pagina

### 1. Pedido fonte

Na referencia, a fonte principal e `bling_orders`. O pedido fonte e tratado como leitura. A conciliacao nao deve sobrescrever a venda original.

No `br-steel`, o equivalente atual e a colecao Firestore `salesOrders`, tipada por `src/types/sale-order.ts`.

### 2. Venda normalizada para conciliacao

A referencia converte o pedido Bling em `ConciliationSale`, adicionando campos normalizados:

- identificadores: `id`, `orderNumber`, `marketplaceOrderNumber`, `internalOrderNumber`;
- datas: `saleDate`, `expectedDate`, `shippedDate`, `referenceMonth`;
- produto: descricao, SKU, itens, quantidade, imagem;
- marketplace/canal/conta;
- cliente/endereco;
- status Bling e status de sistema;
- valores financeiros: total, frete, comissao, custo, liquido, imposto;
- dados Shopee/ML/Amazon quando existem;
- `sheetData`, `customData`, `metadata`;
- ajustes manuais;
- devolucoes operacionais;
- campos de conciliacao: `reconciled`, `reconciledAt`, `reconciledBy`.

### 3. Sidecar de conciliacao

A referencia usa tabelas separadas para guardar estado operacional:

- `conciliation_sales`: estado por pedido, sem substituir a origem.
- `conciliation_sale_adjustments`: overrides por campo.
- `conciliation_associations`: vinculos entre pedido e planilhas.
- `conciliation_settings`: calculos, colunas, mapeamentos e automacoes.
- `conciliation_summary`: configuracao dos cards do topo.
- `conciliation_reconciled_sale_snapshots`: snapshot fechado do pedido conciliado.

No `br-steel`, se ficarmos em Firestore, o desenho equivalente seria:

- `conciliationSales/{saleId}`
- `conciliationSaleAdjustments/{adjustmentId}`
- `conciliationSettings/default`
- `conciliationSummary/default`
- `conciliationAssociations/{associationId}`
- `conciliationReconciledSnapshots/{snapshotId}`

### 4. Pipeline de enriquecimento

Na referencia, carregar uma venda envolve:

1. Buscar pedido Bling.
2. Resolver marketplace/canal.
3. Juntar sidecar de conciliacao.
4. Hidratar Mercado Livre/Mercado Pago quando houver.
5. Hidratar Shopee quando houver.
6. Resolver custo de produto por SKU/Bling product id/kit.
7. Aplicar ajustes manuais.
8. Aplicar devolucoes operacionais.
9. Aplicar calculos customizados.

Para o `br-steel`, a primeira entrega deve parar no passo 3 ou 4, conforme os dados disponiveis.

## Funcionalidades por bloco

### Entrada da consulta

Comportamento:

- O usuario escolhe periodo.
- Pode usar atalhos `Mes Passado` e `Mes Atual`.
- Escolhe marketplace.
- Pode buscar pedido global.
- Clica `Aplicar`.
- A tela so busca dados depois disso.

Ponto importante: manter esse comportamento no `br-steel`. Evita carregar todos os pedidos sem necessidade.

### Resumo/KPIs

A referencia tem dois caminhos:

- resumo rapido server-side via RPC;
- fallback/calculo local para metricas dinamicas e colunas customizadas.

Configuracao:

- metrics com `sum`, `count`, `avg`, `formula`;
- formato: moeda, numero, percentual;
- condicoes;
- escopo por marketplace;
- layout `grid-4`, `grid-5`, `grid-6`;
- icone e cor.

MVP recomendado:

- cards fixos: faturamento bruto, custo do produto, margem, quantidade conciliada.
- configuracao dinamica so em fase posterior.

### Tabela

Recursos existentes:

- 49 colunas potenciais no cenario observado.
- Colunas por grupo/fonte:
  - Bling
  - Sistema
  - Mercado Livre
  - Shopee
  - Planilha
  - Coluna calculada
- Mostrar/ocultar colunas.
- Reordenacao por drag no cabecalho.
- Ordenacao por coluna.
- Linhas expansivas para pedidos de carrinho/multiplos itens.
- Alternancia entre tabela e cards.
- Exportacao XLSX.
- Indicador de pedido conciliado.
- Checkbox de selecao individual e selecao filtrada.

MVP recomendado:

- tabela fixa com poucas colunas;
- paginacao;
- detalhe de pedido;
- indicador/checkbox de conciliado;
- sem reordenacao de coluna na primeira fase.

### Filtros adicionais

Filtros existentes:

- busca textual;
- conta;
- status do pedido;
- status de entrega marketplace;
- marca;
- conciliado / nao conciliado;
- com / sem associacao de planilha;
- marketplace, quando aplicavel.

MVP recomendado:

- busca;
- conta/loja;
- status;
- conciliado.

### Status do pedido

O status exibido na coluna `Status Pedido` e resolvido por prioridade:

1. status manual salvo pelo usuario;
2. status automatico por mapeamento de colunas/status;
3. regras default por marketplace/status de entrega;
4. fallback configurado.

Status default observados no codigo:

- Entregue
- Cancelado
- Devolucao
- Devolucao / Reembolso Parcial
- Extravio
- Em Transito

MVP recomendado:

- permitir status manual simples;
- manter status automatico basico por status Bling;
- deixar mapeamentos avancados para depois.

### Conciliação automatica

A referencia tem regras configuraveis:

- uma regra mira um status do sistema;
- pode ter condicoes por coluna;
- operadores: menor, menor/igual, maior, maior/igual, igual, negativo, entre;
- preview mostra quantos pedidos seriam afetados;
- pode aplicar somente em nao conciliados;
- pedidos com revisao pendente nao entram automaticamente.

MVP recomendado:

- nao implementar na primeira fase;
- primeiro implementar marcacao manual e snapshots.

### Ajustes manuais por pedido

O modal de detalhe permite ajustes em:

- campos de planilha;
- campos de marketplace;
- colunas calculadas;
- status de sistema.

Os ajustes sao salvos como registros em `conciliation_sale_adjustments`, com:

- escopo (`sheet`, `marketplace`, `calculated`, `status`, etc.);
- chave do campo;
- valor original;
- valor ajustado;
- motivo;
- ativo/inativo;
- usuario que alterou.

MVP recomendado:

- salvar somente `status` e `reconciled`;
- depois liberar ajustes financeiros e calculados.

### Calculos customizados

O `CalculationDialog` e um construtor de formulas:

- usa colunas do sistema, Bling, marketplace, planilha e calculos anteriores;
- operadores `+`, `-`, `*`, `/`, parenteses;
- numeros digitados pelo usuario;
- valor condicional;
- formulas condicionais por status/marketplace;
- preview em pedidos reais;
- bloqueio de dependencia circular;
- opcao de percentual;
- opcao de interagir com outra coluna.

MVP recomendado:

- nao trazer no primeiro corte;
- preparar o modelo para `customData`, mas sem builder.

### Planilhas

A rota complementar `/conciliacao/planilhas` e parte do dominio. A pagina principal depende de:

- arquivos importados;
- colunas exibiveis;
- associacoes por pedido;
- campos agregados;
- conflitos e cross-month.

MVP recomendado:

- deixar planilhas fora da primeira fase;
- depois trazer importacao/associacao como modulo proprio.

### Sincronizacao de marketplace

A referencia tem botao `Sincronizar`, que usa o resultado filtrado atual como escopo.

Para Shopee:

- cria job;
- roda job;
- faz polling;
- conta encontrados/salvos/nao encontrados/falhas.

Para Mercado Livre:

- sincroniza pedidos em batches;
- sincroniza settlement Mercado Pago;
- vincula ao Bling quando possivel.

MVP recomendado:

- nao incluir sincronizacao no primeiro corte;
- usar apenas dados ja importados no `salesOrders`.

## Comparacao com o br-steel

O `br-steel` hoje:

- usa Next.js App Router;
- usa React 18;
- usa Firestore client/server;
- guarda pedidos em `salesOrders`;
- possui `SaleOrder` mais fiel ao payload do Bling;
- lista vendas em `src/components/sales-list-page.tsx`;
- carrega todos os pedidos e filtra localmente;
- nao tem sidecar de conciliacao;
- nao tem ajustes por campo;
- nao tem configuracao de colunas/calculos/resumo;
- nao tem dados Shopee/Amazon normalizados equivalentes aos da referencia;
- nao tem pagina `/conciliacao`;
- permissoes atuais nao incluem `/conciliacao`.

Principais lacunas:

1. Modelo normalizado `ConciliationSale`.
2. Sidecar persistente de conciliacao.
3. Consultas por periodo/marketplace com paginacao real.
4. Indices Firestore para filtros da conciliacao.
5. UI de tabela/detalhe.
6. Status de sistema e marcacao como conciliado.
7. Snapshots ao conciliar.
8. Enriquecimento de marketplace.
9. Planilhas e calculos.

## Plano recomendado de migracao

### Fase 1 - MVP somente leitura

Objetivo: criar `/conciliacao` no `br-steel` com fluxo parecido, mas simples.

Entregar:

- rota `src/app/conciliacao/page.tsx`;
- `ConciliacaoClient`;
- tipo `ConciliationSale` adaptado ao `SaleOrder`;
- servico que lista `salesOrders` por periodo;
- filtro por marketplace usando `loja.nome` / `intermediador.nomeUsuario`;
- botao `Aplicar`;
- estado vazio antes da consulta;
- cards fixos de resumo;
- tabela fixa;
- paginacao;
- modal de detalhe somente leitura.

Nao entregar ainda:

- calculos customizados;
- planilhas;
- sync marketplace;
- status mapping avancado;
- exportacao avancada;
- reordenacao de colunas.

### Fase 2 - Sidecar e conciliacao manual

Entregar:

- colecao `conciliationSales`;
- status `reconciled`, `reconciledAt`, `reconciledBy`;
- selecao de linhas;
- acoes em massa: marcar/desmarcar conciliado;
- snapshot basico em `conciliationReconciledSnapshots`;
- bloquear edicao de pedido conciliado;
- permissao `/conciliacao`.

### Fase 3 - Tabela operacional

Entregar:

- filtros adicionais;
- busca local/debounced;
- exportacao XLSX;
- visibilidade de colunas;
- ordem de colunas persistida;
- modo cards;
- linhas de pedido de carrinho com expansao de itens.

### Fase 4 - Status de sistema

Entregar:

- status manual;
- status automatico basico;
- configuracao de status do sistema;
- mapeamento de status por origem;
- preview de impacto.

### Fase 5 - Calculos e resumo configuravel

Entregar:

- modelo `customCalculations`;
- avaliador de formulas;
- colunas calculadas na tabela;
- configuracao dinamica dos cards;
- validacao de formulas.

### Fase 6 - Planilhas de apoio

Entregar:

- importacao de planilhas;
- mapeamento de colunas;
- associacao com pedidos;
- visualizacao de campos de planilha no detalhe;
- ajustes manuais de planilha.

### Fase 7 - Marketplace enrichment

Entregar conforme disponibilidade de dados:

- Shopee order fields;
- Amazon order fields;
- Mercado Livre/Mercado Pago;
- custos/frete/escrow/comissoes;
- status de entrega marketplace.

## Arquitetura sugerida para o br-steel

Arquivos novos provaveis:

- `src/app/conciliacao/page.tsx`
- `src/app/conciliacao/ConciliacaoClient.tsx`
- `src/types/conciliation.ts`
- `src/services/conciliation-service.ts`
- `src/lib/conciliation/normalize-sale-order.ts`
- `src/lib/conciliation/summary.ts`
- `src/lib/conciliation/status.ts`
- `src/components/conciliacao/ConciliacaoFilters.tsx`
- `src/components/conciliacao/ConciliacaoSummary.tsx`
- `src/components/conciliacao/ConciliacaoTable.tsx`
- `src/components/conciliacao/ConciliacaoSaleDetailsDialog.tsx`
- `src/components/conciliacao/ConciliacaoBatchActions.tsx`

Alteracoes provaveis:

- adicionar `/conciliacao` em `src/components/dashboard-layout.tsx`;
- adicionar permissao em `src/lib/permissions.ts`;
- adicionar regras Firestore para novas colecoes;
- adicionar indices Firestore para `salesOrders` e `conciliationSales`.

## Decisoes tecnicas antes de implementar

1. Backend da conciliacao:
   - manter Firestore por agora;
   - ou migrar esta parte para Supabase/Postgres.

2. Identificador canonico do pedido:
   - usar `salesOrders/{id}` atual;
   - mapear tambem `numero`, `numeroLoja` e identificadores de marketplace.

3. Marketplace suportado no primeiro corte:
   - o `br-steel` hoje parece ter Bling + Mercado Livre forte;
   - a referencia observada carregou Shopee/Amazon;
   - precisamos decidir se o MVP filtra por `loja.nome` generico ou se ja foca em uma origem.

4. Performance:
   - a referencia usa RPC/cursor/chunks.
   - no Firestore, evitar `onSnapshot` de todos os pedidos para conciliacao.
   - preferir server actions/API por periodo com `where('data', '>=')`, `where('data', '<=')`, `orderBy('data', 'desc')`, `limit`.

5. Edicoes e fechamento:
   - adotar sidecar desde o inicio.
   - nao editar `salesOrders` para decisoes de conciliacao.

## Riscos

- Copiar a pagina inteira vai trazer dependencias de Supabase/RPCs que nao existem no `br-steel`.
- A referencia usa React 19 + Vite; o alvo usa React 18 + Next 15.
- A referencia depende de tabelas normalizadas de Shopee, Mercado Livre, Mercado Pago e produto que nao parecem existir igual no alvo.
- Calculos customizados e status mapping dependem de muitos campos dinamicos; sem modelo normalizado eles ficam frageis.
- Firestore pode ficar caro/lento se a conciliacao carregar muitos pedidos sem paginacao.
- O detalhe de pedido tem muita edicao; sem snapshots/locks, e facil permitir alteracao em pedido ja conciliado.

## Primeiro corte recomendado

Implementar apenas:

- rota;
- filtros periodo + marketplace + aplicar;
- normalizador `SaleOrder -> ConciliationSale`;
- resumo fixo;
- tabela fixa;
- modal de detalhe somente leitura;
- paginacao;
- nenhum salvamento alem de leitura.

Depois, no segundo corte:

- criar sidecar;
- marcar/desmarcar conciliado;
- batch actions;
- snapshots basicos.

Essa sequencia reduz risco e ja coloca a pagina real dentro do `br-steel`, sem importar de uma vez a parte mais complexa da referencia.
