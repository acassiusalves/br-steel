import 'server-only';
import { createPostgresSalesInvoices } from './postgres-sales-invoices';
import { postgresOnlyRepository } from './source';

/** Só PostgreSQL (Supabase): cópia das NF-e de saída do Bling para os vendidos do gerador de OP. */
export const salesInvoiceRepository = postgresOnlyRepository(pool => createPostgresSalesInvoices(pool));
