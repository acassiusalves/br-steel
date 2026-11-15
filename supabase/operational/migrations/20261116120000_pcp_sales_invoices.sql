-- Cópia das NF-e de saída do Bling para o gerador de OP (regra do Marcos, 10/11/2026).
--
-- Os vendidos e a média semanal saem das notas fiscais de saída, nunca dos pedidos: há pedido sem nota.
-- A rotina copia o cabeçalho de todas as notas dos últimos 120 dias (inclusive as canceladas, para saber
-- que deixaram de contar) e os itens de cada nota. A soma por SKU é feita na hora de gerar a sugestão.
begin;

create table brsteel_pcp.sales_invoices (
  bling_id bigint primary key,
  number text check (length(number) <= 20),
  -- Situação no Bling: 1 pendente, 2 cancelada, 5 autorizada, 6 emitida DANFE etc. Só a 2 deixa de contar.
  situation smallint not null check (situation between 0 and 99),
  issued_at timestamptz not null,
  -- Situação da nota quando os itens foram copiados; nulo = itens ainda não copiados.
  items_situation smallint check (items_situation between 0 and 99),
  -- Última vez que a nota apareceu na listagem do Bling. Nota que some da listagem foi excluída lá.
  listed_at timestamptz not null default now()
);
create index sales_invoices_issued_at on brsteel_pcp.sales_invoices (issued_at);

create table brsteel_pcp.sales_invoice_items (
  invoice_id bigint not null references brsteel_pcp.sales_invoices (bling_id) on delete cascade,
  position smallint not null check (position >= 0),
  sku text not null check (length(sku) between 1 and 100),
  quantity numeric(14,5) not null,
  cfop text check (length(cfop) <= 10),
  primary key (invoice_id, position)
);
create index sales_invoice_items_sku on brsteel_pcp.sales_invoice_items (sku);

-- Códigos fora da linha oficial que aparecem nas notas. O formato diz se é kit (E); a estrutura do kit
-- ([{"blingId": 1, "quantity": 2}]) explode a venda nos componentes da linha.
create table brsteel_pcp.sales_item_products (
  sku text primary key check (length(sku) between 1 and 100),
  bling_id bigint,
  format text check (length(format) <= 5),
  components jsonb not null default '[]'::jsonb check (jsonb_typeof(components) = 'array'),
  checked_at timestamptz not null default now()
);

alter table brsteel_pcp.sales_invoices enable row level security;
alter table brsteel_pcp.sales_invoice_items enable row level security;
alter table brsteel_pcp.sales_item_products enable row level security;
revoke all on brsteel_pcp.sales_invoices, brsteel_pcp.sales_invoice_items, brsteel_pcp.sales_item_products from public;

grant select, insert, update, delete on brsteel_pcp.sales_invoices, brsteel_pcp.sales_invoice_items, brsteel_pcp.sales_item_products to brsteel_ops_writer;
create policy writer on brsteel_pcp.sales_invoices for all to brsteel_ops_writer using (true) with check (true);
create policy writer on brsteel_pcp.sales_invoice_items for all to brsteel_ops_writer using (true) with check (true);
create policy writer on brsteel_pcp.sales_item_products for all to brsteel_ops_writer using (true) with check (true);

grant select on brsteel_pcp.sales_invoices, brsteel_pcp.sales_invoice_items, brsteel_pcp.sales_item_products to brsteel_ops_reader;
create policy reader on brsteel_pcp.sales_invoices for select to brsteel_ops_reader using (true);
create policy reader on brsteel_pcp.sales_invoice_items for select to brsteel_ops_reader using (true);
create policy reader on brsteel_pcp.sales_item_products for select to brsteel_ops_reader using (true);

grant select on brsteel_pcp.sales_invoices, brsteel_pcp.sales_invoice_items, brsteel_pcp.sales_item_products to brsteel_ops_backup;
create policy backup_reader on brsteel_pcp.sales_invoices for select to brsteel_ops_backup using (true);
create policy backup_reader on brsteel_pcp.sales_invoice_items for select to brsteel_ops_backup using (true);
create policy backup_reader on brsteel_pcp.sales_item_products for select to brsteel_ops_backup using (true);

commit;
