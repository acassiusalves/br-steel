import 'server-only';
import { firestoreSkuWeeklyDemandRepository } from './firestore-sku-weekly-demand';
import { createPostgresSkuWeeklyDemandRepository } from './postgres-sku-weekly-demand';
import { selectRepository } from './source';

/** Resolvido por chamada: o rollup e a série seguem a fonte ativa, como o restante do núcleo. */
export const skuWeeklyDemandRepository = selectRepository(firestoreSkuWeeklyDemandRepository, createPostgresSkuWeeklyDemandRepository);
