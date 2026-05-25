import { NextResponse, type NextRequest } from 'next/server';
import { requirePagePermission } from '@/lib/server-auth';
import type { DeepSearchResult } from '@/lib/deep-search-types';
import { listDeepSearchAnalyses, loadDeepSearchAnalysis, saveDeepSearchAnalysis } from '@/services/deep-search-history';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const permission = await requirePagePermission(request, '/buscar-mercado-livre');
  if (!permission.ok) return permission.response;

  try {
    const analysisId = request.nextUrl.searchParams.get('analysisId')?.trim();
    if (analysisId) {
      const analysis = await loadDeepSearchAnalysis(analysisId);
      if (!analysis) {
        return NextResponse.json({ ok: false, error: 'Análise não encontrada.' }, { status: 404 });
      }
      return NextResponse.json({ ok: true, analysis });
    }

    const limitParam = Number(request.nextUrl.searchParams.get('limit') || 40);
    const analyses = await listDeepSearchAnalyses(Number.isFinite(limitParam) ? limitParam : 40);
    return NextResponse.json({ ok: true, analyses });
  } catch (error) {
    console.error('[mercado-livre/deep-search/saved] Falha ao carregar análises:', error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Falha ao carregar análises salvas.' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const permission = await requirePagePermission(request, '/buscar-mercado-livre');
  if (!permission.ok) return permission.response;

  try {
    const body = (await request.json().catch(() => ({}))) as { result?: DeepSearchResult };
    if (!body.result?.sessionId || !body.result?.metadata || !Array.isArray(body.result.queryResults)) {
      return NextResponse.json({ ok: false, error: 'Análise inválida para salvar.' }, { status: 400 });
    }

    const summary = await saveDeepSearchAnalysis(body.result, permission.user);
    return NextResponse.json({ ok: true, summary });
  } catch (error) {
    console.error('[mercado-livre/deep-search/saved] Falha ao salvar análise:', error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Falha ao salvar análise.' },
      { status: 500 }
    );
  }
}
