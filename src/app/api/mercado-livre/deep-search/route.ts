import { NextResponse, type NextRequest } from 'next/server';
import { requirePagePermission } from '@/lib/server-auth';
import type { SessionUser } from '@/lib/server-auth';
import type { DeepSearchConfig } from '@/lib/deep-search-types';
import { executeDeepSearch } from '@/services/deep-search';
import { saveDeepSearchAnalysis } from '@/services/deep-search-history';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const permission = await requirePagePermission(request, '/buscar-mercado-livre');
  if (!permission.ok) return permission.response;

  try {
    const body = (await request.json().catch(() => ({}))) as {
      accountId?: unknown;
      config?: Partial<DeepSearchConfig>;
      stream?: unknown;
    };
    const accountId = typeof body.accountId === 'string' ? body.accountId.trim() : '';
    const config = body.config as DeepSearchConfig | undefined;

    if (!accountId) {
      return NextResponse.json({ ok: false, error: 'Selecione uma conta do Mercado Livre.' }, { status: 400 });
    }

    if (!config || !Array.isArray(config.baseProducts) || config.baseProducts.length === 0) {
      return NextResponse.json({ ok: false, error: 'Selecione produtos base para iniciar o Deep Search.' }, { status: 400 });
    }

    if (body.stream === true) {
      return streamDeepSearch(accountId, config, permission.user, request.signal);
    }

    const result = await executeDeepSearch(accountId, config);
    try {
      result.savedAnalysis = await saveDeepSearchAnalysis(result, permission.user);
    } catch (saveError) {
      console.error('[mercado-livre/deep-search] Falha ao salvar análise:', saveError);
      result.savedAnalysis = null;
      result.progress = {
        ...result.progress,
        errors: [
          ...result.progress.errors,
          `Falha ao salvar análise: ${saveError instanceof Error ? saveError.message : 'erro desconhecido'}`,
        ],
      };
    }
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    console.error('[mercado-livre/deep-search] Falha no Deep Search:', error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Falha ao executar Deep Search.' },
      { status: 500 }
    );
  }
}

function streamDeepSearch(
  accountId: string,
  config: DeepSearchConfig,
  user: SessionUser,
  signal: AbortSignal
) {
  const encoder = new TextEncoder();
  const stream = new TransformStream();
  const writer = stream.writable.getWriter();
  let closed = false;
  let writeQueue = Promise.resolve();
  const abortController = new AbortController();

  signal.addEventListener('abort', () => {
    closed = true;
    abortController.abort();
  });

  function send(event: string, data: unknown) {
    if (closed) return writeQueue;
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    writeQueue = writeQueue
      .then(() => writer.write(encoder.encode(payload)))
      .catch(() => {
        closed = true;
      });
    return writeQueue;
  }

  void (async () => {
    let latestProgress: unknown = null;
    const heartbeat = setInterval(() => {
      void send('heartbeat', {
        at: new Date().toISOString(),
        progress: latestProgress,
      });
    }, 10000);

    try {
      await send('started', { at: new Date().toISOString() });
      const result = await executeDeepSearch(accountId, config, (progress) => {
        latestProgress = progress;
        void send('progress', progress);
      }, abortController.signal);
      try {
        result.savedAnalysis = await saveDeepSearchAnalysis(result, user);
      } catch (saveError) {
        console.error('[mercado-livre/deep-search] Falha ao salvar análise:', saveError);
        result.savedAnalysis = null;
        result.progress = {
          ...result.progress,
          errors: [
            ...result.progress.errors,
            `Falha ao salvar análise: ${saveError instanceof Error ? saveError.message : 'erro desconhecido'}`,
          ],
        };
      }
      latestProgress = result.progress;
      await send('result', result);
    } catch (error) {
      if (!abortController.signal.aborted) {
        await send('error', {
          error: error instanceof Error ? error.message : 'Falha ao executar Deep Search.',
        });
      }
    } finally {
      clearInterval(heartbeat);
      await writeQueue.catch(() => undefined);
      if (!closed) {
        closed = true;
        await writer.close().catch(() => undefined);
      }
    }
  })();

  return new Response(stream.readable, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
