-- OP avulsa, OP a partir de pedido de venda do Bling e urgência no Kanban (reunião de 13/11/2026).
--
-- `origin` diz como a OP nasceu: fila de reposição, avulsa, pedido de venda do Bling ou carga do iApp.
-- A OP de pedido guarda o id e o número do pedido no Bling, para rastreio e para avisar quando o mesmo
-- pedido já gerou OP. Nada do cliente é copiado. A urgência usa a coluna `priority`, que já existe.
begin;

alter table brsteel_pcp.production_order_batches
  add column origin text not null default 'fila' check (origin in ('fila', 'avulsa', 'pedido'));

alter table brsteel_pcp.production_orders
  add column origin text not null default 'fila' check (origin in ('fila', 'avulsa', 'pedido', 'iapp')),
  add column bling_order_id bigint,
  add column bling_order_number text check (length(bling_order_number) between 1 and 30),
  add constraint production_orders_sales_order check (
    (origin = 'pedido') = (bling_order_id is not null)
    and (bling_order_id is null) = (bling_order_number is null));

update brsteel_pcp.production_orders set origin = 'iapp' where iapp_id is not null;

-- Não é único: gerar de novo o mesmo pedido é permitido, com confirmação na tela.
create index production_orders_bling_order on brsteel_pcp.production_orders (bling_order_id)
  where bling_order_id is not null;

alter table brsteel_pcp.production_order_events drop constraint production_order_events_kind_check;
alter table brsteel_pcp.production_order_events add constraint production_order_events_kind_check
  check (kind in ('move', 'start', 'finish', 'loss', 'pause', 'resume', 'close', 'priority'));

commit;
