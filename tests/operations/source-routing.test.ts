import { afterEach, expect, it } from 'vitest';
import { seedOperations, context } from './fixtures';
import { adminDb } from '../helpers/firestore';
import { salesReadRepository } from '@/server/persistence/sales';
import { stockReadRepository } from '@/server/persistence/stock';
import { requireFirestoreSource, resetOperationalSource } from '@/server/persistence/source';
import { invalidateProductStockCache, listProductStock } from '@/server/operations/stock';

/**
 * Toda leitura de dados do núcleo tem de passar pelos repositórios trocáveis.
 *
 * Uma consulta direta em `adminDb.collection(...)` ignora `operationalSource` e, depois de um corte
 * para PostgreSQL, continua respondendo a partir de uma coleção que parou de crescer — sem erro, com
 * números cada vez mais defasados. Foi assim que o rollup semanal quebrou em silêncio, e o mesmo
 * padrão existia em mais oito pontos.
 *
 * Estes testes fixam a regra pelo comportamento observável: com a fonte em `postgres` e sem conexão
 * configurada, cada leitura precisa falhar alto. Uma que responder está lendo o Firestore apesar do
 * seletor, que é exatamente o defeito.
 */
async function comFontePostgres<T>(run: () => Promise<T>): Promise<T> {
  await adminDb.collection('appConfig').doc('operationalSource').set({ source: 'postgres' });
  resetOperationalSource();
  return run();
}

afterEach(async () => {
  await adminDb.collection('appConfig').doc('operationalSource').delete();
  resetOperationalSource();
});

it('a contagem de pedidos não responde a partir do Firestore quando a fonte é postgres', async () => {
  await seedOperations();
  await comFontePostgres(async () => {
    await expect(salesReadRepository.count()).rejects.toThrow();
  });
});

it('a data do último pedido não responde a partir do Firestore quando a fonte é postgres', async () => {
  await seedOperations();
  await comFontePostgres(async () => {
    await expect(salesReadRepository.lastOrderDate()).rejects.toThrow();
  });
});

it('os IDs já importados não respondem a partir do Firestore quando a fonte é postgres', async () => {
  await seedOperations();
  await comFontePostgres(async () => {
    await expect(salesReadRepository.importedOrderIds({})).rejects.toThrow();
  });
});

it('as observações de estoque não respondem a partir do Firestore quando a fonte é postgres', async () => {
  await seedOperations();
  await comFontePostgres(async () => {
    await expect(stockReadRepository.snapshot()).rejects.toThrow();
  });
});

/**
 * As ferramentas administrativas destrutivas varrem uma coleção inteira e não têm equivalente na
 * outra fonte. Depois de um corte elas apagariam a base que não está mais em uso, e o operador veria
 * "pronto" sem que nada do que ele quis apagar tivesse saído. Recusar é a única resposta honesta.
 */
it('a guarda recusa ação exclusiva do Firestore quando a fonte é outra, e libera quando é Firestore', async () => {
  await seedOperations();
  await comFontePostgres(async () => {
    await expect(requireFirestoreSource('Apagar todos os pedidos')).rejects.toThrow(/fonte ativa é postgres/);
  });
  await adminDb.collection('appConfig').doc('operationalSource').delete();
  resetOperationalSource();
  await expect(requireFirestoreSource('Apagar todos os pedidos')).resolves.toBeUndefined();
});

/** A fonte ausente continua significando Firestore: a leitura responde normalmente. */
it('com a fonte ausente, as leituras respondem pelo Firestore', async () => {
  await seedOperations();
  expect(await salesReadRepository.count()).toBe(3);
  expect(await salesReadRepository.lastOrderDate()).toBe('2026-09-02');
  expect((await salesReadRepository.importedOrderIds({})).size).toBe(3);
});

/**
 * O caminho vivo da tela de estoque mesclava observações de webhook lidas direto do Firestore sobre a
 * resposta do Bling. Sem passar pelo repositório, depois de um corte ele sobreporia saldos de uma
 * coleção que parou de receber webhooks — e a tela mostraria estoque velho como se fosse atual.
 */
it('a tela de estoque não mescla observações do Firestore quando a fonte é postgres', async () => {
  await seedOperations();
  await invalidateProductStockCache();
  await comFontePostgres(async () => {
    await expect(listProductStock(context(), {})).rejects.toThrow();
  });
});
