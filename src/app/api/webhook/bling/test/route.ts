import { NextResponse } from 'next/server';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { invalidateStockCache, clearStockUpdates } from '@/app/actions';

// Firestore reference for stock updates
const stockStatusDocRef = doc(db, "appConfig", "stockWebhookStatus");

// POST - Simulate a stock webhook for testing
export async function POST(request: Request) {
  const startTime = Date.now();

  try {
    const body = await request.json();
    const { sku, quantidade, nome } = body;

    if (!sku) {
      return NextResponse.json({ error: 'SKU é obrigatório' }, { status: 400 });
    }

    console.log('═══════════════════════════════════════════════════════════');
    console.log('🧪 [WEBHOOK-TEST] Simulando evento de estoque');
    console.log(`🧪 [WEBHOOK-TEST] SKU: ${sku}, Quantidade: ${quantidade || 0}`);
    console.log('═══════════════════════════════════════════════════════════');

    const stockData = {
      sku,
      nome: nome || '',
      estoqueAtual: quantidade ?? 0,
      depositos: [],
      webhookReceivedAt: new Date().toISOString(),
      lastEvent: 'estoque.updated (test)',
    };

    // Salvar no Firebase - collection stockUpdates
    const stockDocRef = doc(db, 'stockUpdates', sku);
    await setDoc(stockDocRef, stockData, { merge: true });

    console.log(`✅ [WEBHOOK-TEST] SKU ${sku}: estoque = ${stockData.estoqueAtual}`);

    // Atualizar status do webhook de estoque
    const statusSnap = await getDoc(stockStatusDocRef);
    const currentStatus = statusSnap.exists() ? statusSnap.data() : { totalReceived: 0 };

    await setDoc(stockStatusDocRef, {
      lastUpdate: new Date().toISOString(),
      lastEvent: 'estoque.updated (test)',
      lastProcessed: 1,
      totalReceived: (currentStatus.totalReceived || 0) + 1,
    });

    // Invalidar cache de estoque
    invalidateStockCache();

    return NextResponse.json({
      success: true,
      message: `Estoque de teste processado: ${sku}`,
      data: stockData,
      processedIn: `${Date.now() - startTime}ms`,
    });

  } catch (error: any) {
    console.error('❌ [WEBHOOK-TEST] Erro:', error.message);
    return NextResponse.json({
      success: false,
      error: error.message,
      processedIn: `${Date.now() - startTime}ms`,
    }, { status: 500 });
  }
}

// DELETE - Clear all stock updates (test data)
export async function DELETE() {
  const startTime = Date.now();

  try {
    console.log('🗑️ [WEBHOOK-TEST] Limpando dados de estoque de teste...');

    const result = await clearStockUpdates();

    // Invalidar cache de estoque
    await invalidateStockCache();

    console.log(`✅ [WEBHOOK-TEST] ${result.deleted} documentos removidos`);

    return NextResponse.json({
      success: true,
      message: `Removidos ${result.deleted} documentos de stockUpdates`,
      deleted: result.deleted,
      processedIn: `${Date.now() - startTime}ms`,
    });

  } catch (error: any) {
    console.error('❌ [WEBHOOK-TEST] Erro ao limpar:', error.message);
    return NextResponse.json({
      success: false,
      error: error.message,
      processedIn: `${Date.now() - startTime}ms`,
    }, { status: 500 });
  }
}

// GET - Instructions
export async function GET() {
  return NextResponse.json({
    message: 'Endpoint de teste para webhook de estoque',
    usage: {
      POST: {
        description: 'Simula um webhook de estoque',
        body: {
          sku: 'SKU do produto (obrigatório)',
          quantidade: 'Quantidade em estoque (opcional, default 0)',
          nome: 'Nome do produto (opcional)',
        },
        example: {
          sku: 'SECASAL5LT',
          quantidade: 10,
          nome: 'Seca Salada 5LT',
        },
      },
      DELETE: {
        description: 'Limpa todos os dados de teste da collection stockUpdates',
        curl: 'curl -X DELETE https://br-steel.vercel.app/api/webhook/bling/test',
      },
    },
  });
}
