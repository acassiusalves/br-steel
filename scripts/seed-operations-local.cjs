// Synthetic browser fixtures. This script never accepts a production database.
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { randomBytes, scryptSync } = require('node:crypto');
if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8188' || process.env.GCLOUD_PROJECT !== 'demo-brsteel-auth') throw new Error('Local demo emulator required');
initializeApp({ projectId: 'demo-brsteel-auth' }); const db = getFirestore();
async function seed() {
  const response = await fetch('http://127.0.0.1:8188/emulator/v1/projects/demo-brsteel-auth/databases/(default)/documents', { method: 'DELETE' });
  if (!response.ok) throw new Error('Could not reset demo fixtures');
  for (const [id, role] of [['admin', 'Administrador'], ['seller', 'Vendedor'], ['operator', 'Operador']]) {
    const salt = randomBytes(16).toString('base64url');
    await db.collection('users').doc(`fixture-${id}`).set({ name: `Teste ${role}`, email: `${id}@example.test`, normalizedEmail: `${id}@example.test`, role, active: true, authVersion: 0, mustChangePassword: false, passwordSalt: salt, passwordHash: scryptSync('Local-test-only-2026', salt, 64).toString('base64url'), createdAt: new Date().toISOString() });
  }
  for (const [id, date, total, quantity] of [[1, '2026-09-01', 100, 2], [2, '2026-09-02', 200, 4], [3, '2026-08-31', 150, 3]]) {
    await db.collection('salesOrders').doc(String(id)).set({ id, numero: id, numeroLoja: `LOCAL-${id}`, data: date, total, totalProdutos: total, contato: { id, nome: 'Cliente de teste', numeroDocumento: 'DOCUMENTO-PRIVADO' }, situacao: { id: 1, nome: 'Em aberto' }, loja: { id: 1, nome: 'Loja local' }, transporte: { etiqueta: { uf: 'SP' } }, notaFiscal: { id: 100+id, xml: 'XML-PRIVADO' }, itens: [{ id: id*10, codigo: 'ZERO', descricao: 'Chapa de teste', quantidade: quantity, valor: 50, unidade: 'UN' }] });
  }
  await db.collection('stockUpdates').doc('ZERO').set({ sku: 'ZERO', nome: 'Chapa de teste', estoqueAtual: 0, webhookReceivedAt: new Date().toISOString(), lastEvent: 'estoque.updated' });
  await db.collection('supplies').doc('steel').set({ nome: 'Chapa de teste', codigo: 'ZERO', gtin: '', unidade: 'UN', precoCusto: 10, estoqueAtual: 10, estoqueMinimo: 2, estoqueMaximo: 20, tempoEntrega: 2 });
  console.log('Synthetic sales, stock and supplies ready in demo-brsteel-auth.'); await db.terminate();
}
seed().catch(error => { console.error(error.message); process.exitCode = 1; });
