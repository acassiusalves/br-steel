import 'server-only';
import { adminDb } from '@/lib/firebase-admin';
type BlingCredentials = { clientId?: string; clientSecret?: string; accessToken?: string; refreshToken?: string; expiresAt?: number };
export async function getFullBlingCredentials(): Promise<BlingCredentials> {
  const snap = await adminDb.collection('appConfig').doc('blingCredentials').get();
  const saved = snap.exists ? (snap.data() as BlingCredentials) : {};
  return {
    clientId:     saved.clientId     || process.env.BLING_CLIENT_ID,
    clientSecret: saved.clientSecret || process.env.BLING_CLIENT_SECRET,
    accessToken:  saved.accessToken,
    refreshToken: saved.refreshToken,
    expiresAt:    saved.expiresAt,
  };
}


async function refreshAccessToken() {
  const creds = await getFullBlingCredentials();
  if (!creds.clientId || !creds.clientSecret || !creds.refreshToken) {
    throw new Error('Credenciais do Bling incompletas para renovar o token.');
  }

  const basic = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString('base64');
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: String(creds.refreshToken),
  });

  const res = await fetch('https://www.bling.com.br/Api/v3/oauth/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${basic}`,
      'Accept': '1.0', // obrigatório no Bling
    },
    body: body.toString(),
    cache: 'no-store', signal: AbortSignal.timeout(20000),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Refresh falhou (${res.status}): ${json?.error?.description || res.statusText}`);

  const update: Partial<BlingCredentials> = {};
  if (json.access_token) update.accessToken = json.access_token;
  if (json.refresh_token) update.refreshToken = json.refresh_token;
  if (json.expires_in)   update.expiresAt   = Date.now() + Number(json.expires_in) * 1000;

  await adminDb.collection('appConfig').doc('blingCredentials').set(update, { merge: true });
  return { ...creds, ...update };
}

// Rate limiter: max 3 req/sec using a queue-based approach
// This ensures requests are truly serialized even when called in parallel
const MIN_REQUEST_INTERVAL = 400; // ~2.5 req/sec with extra safety margin

class RequestQueue {
  private queue: Array<{ resolve: () => void }> = [];
  private processing = false;
  private lastRequestTime = 0;

  async waitForTurn(): Promise<void> {
    return new Promise((resolve) => {
      this.queue.push({ resolve });
      this.processQueue();
    });
  }

  private async processQueue() {
    if (this.processing) return;
    this.processing = true;

    while (this.queue.length > 0) {
      const now = Date.now();
      const timeSinceLastRequest = now - this.lastRequestTime;

      if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
        await new Promise(r => setTimeout(r, MIN_REQUEST_INTERVAL - timeSinceLastRequest));
      }

      this.lastRequestTime = Date.now();
      const item = this.queue.shift();
      if (item) {
        item.resolve();
      }
    }

    this.processing = false;
  }
}

const requestQueue = new RequestQueue();

export async function blingFetchWithRefresh(url: string, init?: RequestInit, retryCount = 0): Promise<any> {
  const endpoint = new URL(url);
  if (!['https://api.bling.com.br', 'https://www.bling.com.br'].includes(endpoint.origin) || !endpoint.pathname.startsWith('/Api/v3/') || endpoint.username || endpoint.password) throw new Error('Destino Bling inválido.');
  if (process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Bling externo não é acessado pelo ambiente emulado.');
  // Rate limiting - wait for our turn in the queue
  await requestQueue.waitForTurn();

  const startTime = Date.now();

  let creds = await getFullBlingCredentials();
  if (!creds.accessToken && !creds.refreshToken) throw new Error('Bling não conectado.');
  const skewMs = 60 * 1000;

  const needsEarlyRefresh = !creds.expiresAt || (Date.now() + skewMs >= creds.expiresAt);
  if (needsEarlyRefresh) {
    console.log('🔑 [BLING API] Token próximo de expirar, renovando...');
    try { creds = await refreshAccessToken(); } catch (e) {
      console.error('❌ [BLING API] Falha ao renovar token:', e);
    }
  }

  const call = async (token: string) => {
    const res = await fetch(url, {
      ...init,
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${token}`,
        ...(init?.headers || {}),
      },
      cache: 'no-store', signal: AbortSignal.timeout(20000),
    });
    const text = await res.text();
    return { res, text };
  };

  let { res, text } = await call(String(creds.accessToken || ''));

  const maybeInvalid = (status: number, body: string) =>
    status === 401 || (status === 400 && /invalid_token|token expir|unauthorized/i.test(body));

  if (maybeInvalid(res.status, text)) {
    console.log('🔄 [BLING API] Token inválido, tentando renovar...');
    creds = await refreshAccessToken();
    ({ res, text } = await call(String(creds.accessToken || '')));
  }

  const elapsed = Date.now() - startTime;

  // Handle rate limit (429) with retry
  if (res.status === 429 && retryCount < 3) {
    const waitTime = Math.pow(2, retryCount + 1) * 1000; // Exponential backoff: 2s, 4s, 8s
    console.warn(`⚠️ [BLING API] Rate limit atingido, aguardando ${waitTime/1000}s antes de tentar novamente...`);
    await new Promise(resolve => setTimeout(resolve, waitTime));
    return blingFetchWithRefresh(url, init, retryCount + 1);
  }

  if (!res.ok) {
    let payload: any; try { payload = JSON.parse(text); } catch {}
    const msg = payload?.error?.description || res.statusText || text;
    console.error(`❌ [BLING API] Erro ${res.status} após ${elapsed}ms: ${msg}`);
    throw new Error(`Erro do Bling (${res.status}): ${msg}`);
  }

  if (retryCount === 0) {
    // Only log if not a retry (to avoid noise)
    // console.log(`✅ [BLING API] Resposta OK em ${elapsed}ms`);
  }

  try { return text ? JSON.parse(text) : null; }
  catch { throw new Error('A resposta da API do Bling não era um JSON válido.'); }
}


export async function blingGetPaged(baseUrl: string) {
    console.log(`📄 [PAGINAÇÃO] Iniciando busca paginada: ${baseUrl.substring(0, 80)}...`);
    const allData: any[] = [];
    let page = 1;
    const limit = 100;

    while (true) {
        const url = new URL(baseUrl);
        url.searchParams.set('pagina', String(page));
        url.searchParams.set('limite', String(limit));

        console.log(`📄 [PAGINAÇÃO] Buscando página ${page}...`);

        try {
            const responseData = await blingFetchWithRefresh(url.toString());

            const dataOnPage = responseData.data || [];
            allData.push(...dataOnPage);

            console.log(`📄 [PAGINAÇÃO] Página ${page}: ${dataOnPage.length} itens (total acumulado: ${allData.length})`);

            if (dataOnPage.length < limit) {
                console.log(`📄 [PAGINAÇÃO] Fim da paginação - última página tinha ${dataOnPage.length} itens`);
                break;
            }
            page++;
        } catch (error: any) {
            console.error(`❌ [PAGINAÇÃO] Erro na página ${page}: ${error.message}`);
            throw error;
        }
    }

    console.log(`📄 [PAGINAÇÃO] Concluído! Total de ${allData.length} itens em ${page} página(s)`);
    return allData;
}
