// app/api/cron/ml-health/route.ts
//
// Endpoint de health-check diário para todas as contas do Mercado Livre.
// Faz refresh do token + GET /users/me em cada conta de `mercadoLivreAccounts`.
//
// Tem dois efeitos:
//   1. Mantém o refresh_token "vivo" (a doc oficial diz que tokens invalidam
//      após 4 meses sem chamadas).
//   2. Atualiza `apiStatus` da conta (valid/invalid) para a UI exibir.
//
// Configuração no Vercel: adicionar em vercel.json (ou vercel.ts):
//   { "crons": [{ "path": "/api/cron/ml-health", "schedule": "0 6 * * *" }] }
//
// Segurança: protegido via header `Authorization: Bearer ${CRON_SECRET}`.
// O Vercel injeta esse header automaticamente em cron jobs nativos.

import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { pingMlConnection } from '@/app/actions';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret) {
        const authHeader = request.headers.get('authorization');
        if (authHeader !== `Bearer ${cronSecret}`) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
    }

    try {
        const snapshot = await adminDb.collection('mercadoLivreAccounts').get();

        const results = await Promise.allSettled(
            snapshot.docs.map((d) => pingMlConnection(d.id))
        );

        const summary = results.map((r) =>
            r.status === 'fulfilled'
                ? r.value
                : { status: 'invalid' as const, error: String(r.reason) }
        );

        const validCount = summary.filter((s) => s.status === 'valid').length;
        const invalidCount = summary.filter((s) => s.status === 'invalid').length;

        console.log(`[CRON ml-health] Verificadas ${summary.length} contas: ${validCount} valid, ${invalidCount} invalid`);

        return NextResponse.json({
            checked: summary.length,
            valid: validCount,
            invalid: invalidCount,
            results: summary,
        });
    } catch (error: any) {
        console.error('[CRON ml-health] Erro:', error?.message || error);
        return NextResponse.json(
            { error: error?.message || 'Erro inesperado no health-check ML' },
            { status: 500 }
        );
    }
}
