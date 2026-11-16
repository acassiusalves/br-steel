# OP avulsa, OP por pedido de venda do Bling e urgência no Kanban

Plano de 15/11/2026, a partir da reunião de 13/11/2026 com a fábrica. Registro histórico: o comportamento atual é o do código.

## Objetivo

Hoje a OP só nasce da fila de reposição (`/producao/ops`, aba Gerar). A fábrica pediu:

1. **OP avulsa**: escolher um produto com ficha técnica e a quantidade, e gerar a OP sem passar pela fila.
2. **OP de pedido de venda do Bling**: buscar o pedido pelo número, ver os itens e gerar as OPs. O produto principal vai para a dobra e as partes (composições) vão para o corte. O Bling é só leitura (GET).
3. **Urgência**: OP de pedido urgente fura a fila no Kanban.

## Estado de partida

- `createBatch` (`src/server/persistence/postgres-pcp-orders.ts`) grava um lote e, para cada item, uma OP com o roteiro inteiro da ficha. Só no `kind = 'corte'` cria OPs filhas (`parent_order_id`) para os componentes da ficha que têm ficha própria.
- `production_orders.priority` (`estoque | fulfillment | urgente`) já existe e nenhum código do app usa.
- O Kanban ordena os cards por número e não sabe a prioridade, a origem nem a OP mãe.
- `blingFetchWithRefresh` recusa rodar sob o emulador; os leitores do Bling recebem um `get` injetável.

## Desenho

### Migration `20261117120000_pcp_order_origins.sql`

- `production_order_batches.origin` (`fila | avulsa | pedido`, padrão `fila`).
- `production_orders.origin` (`fila | avulsa | pedido | iapp`), `bling_order_id`, `bling_order_number`, com check: origem `pedido` se e só se há pedido. OPs vindas do iApp passam a `origin = 'iapp'`.
- Índice parcial em `bling_order_id` (não único: gerar de novo o mesmo pedido é permitido com confirmação).
- Evento `priority` no check de `production_order_events.kind`.
- Sem tabela nova: backup continua com 40 tabelas e 55 FKs.

### Desdobramento do pedido (`src/lib/pcp/sales-order-plan.ts`, função pura)

1. Soma os itens do pedido por SKU.
2. Item com ficha com roteiro vira uma linha.
3. Item sem ficha e formato `E` no Bling (kit) explode um nível pela estrutura do Bling; kit dentro de kit não explode de novo.
4. Item sem ficha e sem estrutura fica desabilitado, com aviso.
5. As partes de cada linha são os componentes da ficha com ficha própria (mesmo critério do corte multinível). Ficha sem componentes usa a estrutura do Bling como reserva. Matéria-prima só é listada.

Gravação: produto principal em OP mãe `semanal` (dobra); cada parte em OP filha `corte` com `parent_order_id`. Todas com `origin = 'pedido'`, número do pedido e a mesma prioridade. A mãe não espera as filhas. Na planilha do iApp, a mãe com filhas sai multinível `S`.

### Leitor do Bling (`src/server/integrations/bling-sales-orders.ts`, só GET)

- `findByNumber`: `/pedidos/vendas?numero=` com páginas; sem resultado, tenta o número da loja.
- `order(id)`: detalhe e itens.
- `product(id)`: formato e estrutura.

### Repositório, operação e rota

- `listProducible`, `createManualOrder`, `previewSalesOrder`, `createFromSalesOrder`.
- O servidor relê o pedido no Bling ao gerar (o cliente não define o número do pedido). Pedido que já tem OP ativa exige confirmação (`DUPLICATE_SALES_ORDER`, 409).
- Rota existente `/api/operations/production-orders` ganha `view=products` e as ações `createManual`, `previewSalesOrder` e `createFromSalesOrder`.

### Tela de OPs

Abas novas "OP avulsa" e "Pedido do Bling". Origem e selo "Urgente" nas abas OPs e Lotes.

### Urgência no quadro

- Usa `priority = 'urgente'`. Os urgentes vêm primeiro na coluna, depois por número.
- O card mostra o selo, o número do pedido e a OP mãe.
- O administrador liga ou desliga a urgência no card (vale também para as filhas). Isso grava o evento `priority` e um registro de auditoria.
- Reordenar arrastando os cards fica para depois.

## Passos

0. Linha de base: lint, typecheck, Vitest e PostgreSQL.
1. Migration e README do operacional.
2. Regras puras (`sales-order-plan`, `iappImportRows` multinível, `queueOrder`/`priorityError`) com Vitest.
3. Leitor do Bling com Vitest (páginas, número da loja, kit, item sem código, id divergente, só GET).
4. Contrato e repositório de OPs com integração PostgreSQL (avulsa, pedido, kit, duplicidade, validação, Bling fora, exportação, constraint, permissão).
5. Operação, rota e serviço.
6. Tela de OPs.
7. Urgência no quadro.
8. Script de carga do iApp grava `origin = 'iapp'`.
9. Validação completa e PR. A migration é aplicada no projeto hospedado antes do deploy, com autorização.

## Decisões de 15/11/2026

- **Composição:** a ficha técnica decide. Na cópia do cadastro do Bling no Supabase, os 71 SKUs da linha oficial são simples (formato S); nas NF-e copiadas há um só kit (E). Já as fichas técnicas trazem as partes, por exemplo corpo e laterais com ficha própria. A estrutura do Bling só abre kit sem ficha.
- **A OP de dobra não espera o corte:** a OP filha mostra "parte da OP X" e o líder confere.
- **Urgência:** quem gera a OP marca na geração; no quadro, só o administrador liga ou desliga.
- **Estoque cortado:** não é descontado nesta entrega; a prévia deixa desmarcar ou reduzir cada parte.
- **Fora desta entrega:** o fallback "ficha sem componentes usa a estrutura do Bling" (nenhuma ficha da linha precisou) e reordenar cards arrastando.

## Riscos

- Os campos da API de pedidos vêm do uso já existente no repo. Conferir com um GET real antes de dar a aba por pronta.
- Publicar antes da migration quebra a tela de OPs e o quadro.
- A fila mín/máx conta as OPs de pedido em "Em OP"; o efeito depende de o Bling reservar o pedido no saldo virtual.
- Prévia de pedido com muitos kits pode passar de 10 s (teto de 30 consultas de produto).
- Filha `corte` sob mãe `semanal` é combinação nova.
- O nome do cliente aparece só na prévia e não é gravado.
