-- Cópia do cadastro do Bling para o gerador de OP (política mín/máx do script da fábrica).
--
-- A listagem do Bling não traz estoque mínimo/máximo nem o formato: é preciso o GET de detalhe por
-- produto (~350 ms cada). A cópia é atualizada uma vez por dia e pelo botão da tela de OPs; o saldo do
-- depósito Estoque não fica aqui, é lido do Bling na hora de gerar.
begin;

create table brsteel_pcp.bling_products (
  sku text primary key check (length(sku) between 1 and 100),
  bling_id bigint not null unique,
  name text check (length(name) <= 300),
  -- S = simples, E = kit (estrutura), V = com variações.
  format text check (length(format) <= 5),
  stock_min numeric(14,5) check (stock_min >= 0),
  stock_max numeric(14,5) check (stock_max >= 0),
  synced_at timestamptz not null default now()
);

alter table brsteel_pcp.bling_products enable row level security;
revoke all on brsteel_pcp.bling_products from public;
grant select, insert, update, delete on brsteel_pcp.bling_products to brsteel_ops_writer;
create policy writer on brsteel_pcp.bling_products for all to brsteel_ops_writer using (true) with check (true);
grant select on brsteel_pcp.bling_products to brsteel_ops_reader;
create policy reader on brsteel_pcp.bling_products for select to brsteel_ops_reader using (true);
grant select on brsteel_pcp.bling_products to brsteel_ops_backup;
create policy backup_reader on brsteel_pcp.bling_products for select to brsteel_ops_backup using (true);

commit;
