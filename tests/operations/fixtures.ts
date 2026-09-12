import { pagePermissions } from '@/lib/permissions';
import { mcpCapabilities } from '@/lib/mcp-capabilities';
import type { AccessContext } from '@/server/access/types';
import { hashPassword } from '@/lib/server-auth';
import { adminDb, resetDatabase, seedUser } from '../helpers/firestore';
export const context = (role = 'Administrador'): AccessContext => ({ actor: { userId: 'ops-admin', role, source: 'web' }, active: true, capabilities: mcpCapabilities.map(c => c.key), permissions: pagePermissions, inactivePages: [] });
export async function seedOperations() {
  await resetDatabase(); const { hash, salt } = hashPassword('individual-operations-password');
  await seedUser('ops-admin', { name: 'Admin de teste', role: 'Administrador', passwordHash: hash, passwordSalt: salt });
  for (const [id, date, total, qty] of [[1, '2026-09-01', 100, 2], [2, '2026-09-02', 200, 4], [3, '2026-08-31', 150, 3]] as const) {
    await adminDb.collection('salesOrders').doc(String(id)).set({ id, numero: id, numeroLoja: `loja-${id}`, data: date, total, contato: { id, nome: 'Cliente de teste', numeroDocumento: 'DOCUMENTO-PRIVADO' },
      notaFiscal: { id: 100 + id, xml: 'XML-PRIVADO' }, itens: [{ id: id*10, codigo: 'ZERO', descricao: 'Chapa de teste', quantidade: qty, valor: 50, unidade: 'UN' }] });
  }
  await adminDb.collection('supplies').doc('steel').set({ nome: 'Chapa', codigo: 'ZERO', gtin: '', unidade: 'UN', precoCusto: 10, estoqueAtual: 10, estoqueMinimo: 2, estoqueMaximo: 20, tempoEntrega: 2 });
}
