import assert from 'node:assert/strict';

const STAGING_ORIGIN = 'https://br-steel-mcp-staging.vercel.app';
const PRODUCTION_ORIGIN = 'https://br-steel.vercel.app';
const SOURCE_PROJECT = 'marketflow-9h4tg';
const DAY_MS = 24 * 60 * 60 * 1000;
const authorizationIdPattern = /^[A-Za-z0-9_-]{16,128}$/;
const lowerHexSha256 = /^[0-9a-f]{64}$/;

type Environment = Record<string, string | undefined>;
type ToolHttpSample = { startedAt: number; elapsedMs: number; decodedResponseBytes: number };
export type ActiveToolHttpMeasurement = ToolHttpSample & { responseCount: number };

export type PostgresPilotProof = {
  enabled: boolean;
  errors: string[];
  snapshotHash?: string;
  expiresAt?: string;
};

/** Pure guard that must run before the proof constructs any remote client. */
export function postgresPilotProofGuard(env: Environment, proofUserId: string, now = Date.now()): PostgresPilotProof {
  const requested = env.MCP_PG_PILOT_VERIFY;
  if (requested === undefined || requested === 'false') return { enabled: false, errors: [] };
  if (requested !== 'true') return { enabled: false, errors: ['MCP_PG_PILOT_VERIFY must be missing, false or true.'] };

  const errors: string[] = [];
  const require = (condition: unknown, message: string) => { if (!condition) errors.push(message); };
  require(env.MCP_PG_PILOT_ENABLED === 'true', 'MCP_PG_PILOT_ENABLED must be true for pilot verification.');
  require(Boolean(proofUserId) && env.MCP_PG_PILOT_USER_IDS === proofUserId,
    'MCP_PG_PILOT_USER_IDS must equal the one synthetic proof user.');
  const snapshotHash = env.MCP_PG_PILOT_SNAPSHOT_HASH ?? '';
  require(lowerHexSha256.test(snapshotHash), 'MCP_PG_PILOT_SNAPSHOT_HASH must be 64 lower-hex characters.');
  const expiresAt = env.MCP_PG_PILOT_EXPIRES_AT ?? '';
  const expiresAtMs = Date.parse(expiresAt);
  require(Number.isFinite(expiresAtMs) && new Date(expiresAtMs).toISOString() === expiresAt,
    'MCP_PG_PILOT_EXPIRES_AT must be a canonical ISO timestamp.');
  require(Number.isFinite(expiresAtMs) && expiresAtMs > now && expiresAtMs <= now + DAY_MS,
    'MCP_PG_PILOT_EXPIRES_AT must be in the future and no more than 24 hours away.');
  return { enabled: true, errors, snapshotHash, expiresAt };
}

/** Accept the known shared-provider production redirect only in pilot mode, then route locally to staging. */
export function parseProofConsentRedirect(location: string, pilot: boolean) {
  try {
    const url = new URL(location);
    const allowedOrigin = url.origin === STAGING_ORIGIN || (pilot && url.origin === PRODUCTION_ORIGIN);
    const entries = [...url.searchParams.entries()];
    const authorizationId = url.searchParams.get('authorization_id') ?? '';
    assert.ok(allowedOrigin && url.protocol === 'https:' && !url.username && !url.password && !url.hash);
    assert.equal(url.pathname, '/oauth/consent');
    assert.equal(entries.length, 1);
    assert.equal(entries[0]?.[0], 'authorization_id');
    assert.match(authorizationId, authorizationIdPattern);
    return {
      authorizationId,
      stagingPath: `/oauth/consent?authorization_id=${encodeURIComponent(authorizationId)}`,
      sharedProviderProductionRedirect: url.origin === PRODUCTION_ORIGIN,
    };
  } catch {
    throw new Error('Unexpected OAuth consent redirect');
  }
}

type ReadCopy = {
  mode: 'pilot';
  sourceProject: string;
  snapshotHash: string;
  capturedAt: string;
  completedAt: string;
};

function canonicalTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const epoch = Date.parse(value);
  return Number.isFinite(epoch) && new Date(epoch).toISOString() === value;
}

/** Validate the contract and return only report-safe copy metadata. */
export function assertPostgresBusinessResult(value: unknown, expectedSnapshotHash: string): ReadCopy {
  try {
    assert.ok(value && typeof value === 'object');
    const result = value as Record<string, unknown>;
    assert.ok(Object.hasOwn(result, 'data'));
    assert.equal(result.source, 'postgres');
    assert.ok(typeof result.nextCursor === 'string' || result.nextCursor === null);
    assert.ok(Array.isArray(result.warnings) && result.warnings.every(item => typeof item === 'string'));
    assert.ok(result.warnings.some(item => /c[oó]pia.*piloto/i.test(item)
      && /(?:dados atuais|desatualiz|captur|tempor[aá]ri|snapshot)/i.test(item)));
    assert.ok(result.readCopy && typeof result.readCopy === 'object');
    const copy = result.readCopy as Record<string, unknown>;
    assert.equal(copy.mode, 'pilot');
    assert.equal(copy.sourceProject, SOURCE_PROJECT);
    assert.equal(copy.snapshotHash, expectedSnapshotHash);
    assert.ok(lowerHexSha256.test(String(copy.snapshotHash)));
    const capturedAt = copy.capturedAt, completedAt = copy.completedAt;
    assert.ok(canonicalTimestamp(capturedAt));
    assert.ok(canonicalTimestamp(completedAt));
    assert.equal(result.asOf, capturedAt);
    assert.ok(Date.parse(completedAt) >= Date.parse(capturedAt));
    return {
      mode: 'pilot',
      sourceProject: SOURCE_PROJECT,
      snapshotHash: expectedSnapshotHash,
      capturedAt,
      completedAt,
    };
  } catch {
    throw new Error('Invalid PostgreSQL pilot response');
  }
}

export function assertLiveAccessResult(value: unknown) {
  try {
    assert.ok(value && typeof value === 'object');
    const result = value as Record<string, unknown>;
    assert.ok(Object.hasOwn(result, 'data'));
    assert.equal(result.source, 'firestore');
    assert.ok(!Object.hasOwn(result, 'readCopy'));
    assert.ok(canonicalTimestamp(result.asOf));
    assert.ok(Array.isArray(result.warnings));
    assert.ok(typeof result.nextCursor === 'string' || result.nextCursor === null);
  } catch {
    throw new Error('Invalid live access response');
  }
}

const forbiddenProductionKeys = new Set([
  'contato', 'cliente', 'customer', 'numeroDocumento', 'cpf', 'cnpj', 'notaFiscal', 'xml',
  'total', 'totalProdutos', 'valor', 'desconto', 'precoCusto', 'unitCost',
]);

export function assertProductionProjection(value: unknown) {
  const visit = (candidate: unknown): void => {
    if (Array.isArray(candidate)) { for (const item of candidate) visit(item); return; }
    if (!candidate || typeof candidate !== 'object') return;
    for (const [key, nested] of Object.entries(candidate)) {
      if (key === 'customerName' && nested !== '') throw new Error('Restricted production projection');
      if (forbiddenProductionKeys.has(key)) throw new Error('Restricted production projection');
      visit(nested);
    }
  };
  visit(value);
}

export function stockSkuFromProofResult(value: unknown) {
  try {
    assert.ok(value && typeof value === 'object');
    const produto = (value as Record<string, unknown>).produto;
    assert.ok(produto && typeof produto === 'object');
    const codigo = (produto as Record<string, unknown>).codigo;
    assert.ok(typeof codigo === 'string' && /^[^\u0000-\u001f\u007f]{1,200}$/.test(codigo));
    return codigo;
  } catch {
    throw new Error('Stock result has no safe SKU');
  }
}

export async function firstRowFromPagedRead<T extends Record<string, unknown>>(
  read: (cursor: string | undefined, pageSize: number) => Promise<{ data: T[]; nextCursor: string | null }>,
  maxPages: number,
  pageSize = 1,
) {
  assert.ok(Number.isSafeInteger(maxPages) && maxPages >= 1 && maxPages <= 20);
  assert.ok(Number.isSafeInteger(pageSize) && pageSize >= 1 && pageSize <= 100 && maxPages * pageSize <= 100);
  let cursor: string | undefined;
  const seen = new Set<string>();
  for (let page = 0; page < maxPages; page += 1) {
    const response = await read(cursor, pageSize);
    assert.ok(Array.isArray(response.data));
    assert.ok(typeof response.nextCursor === 'string' || response.nextCursor === null);
    if (response.data.length) {
      const selected = response.data[0];
      if (response.nextCursor) {
        if (page + 1 >= maxPages || seen.has(response.nextCursor)) break;
        seen.add(response.nextCursor);
        const continuation = await read(response.nextCursor, pageSize);
        assert.ok(Array.isArray(continuation.data));
        assert.ok(typeof continuation.nextCursor === 'string' || continuation.nextCursor === null);
      }
      return selected;
    }
    if (!response.nextCursor || seen.has(response.nextCursor)) break;
    seen.add(response.nextCursor);
    cursor = response.nextCursor;
  }
  throw new Error('No row found within page bound');
}

function isToolsCallPost(input: RequestInfo | URL, init: RequestInit) {
  const method = (init.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
  if (method !== 'POST' || typeof init.body !== 'string') return false;
  try {
    const message = JSON.parse(init.body);
    return message && !Array.isArray(message) && message.method === 'tools/call'
      && Object.hasOwn(message, 'id') && message.id !== null;
  } catch { return false; }
}

/** Snapshot measurement ownership before awaiting fetch so background MCP traffic cannot join a later tool call. */
export async function fetchWithToolCallMeasurement(
  input: RequestInfo | URL,
  init: RequestInit,
  resource: string,
  active: ActiveToolHttpMeasurement | undefined,
  fetchFn: typeof fetch,
  now: () => number = Date.now,
) {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const measurementAtStart = url.href === resource && active && isToolsCallPost(input, init) ? active : undefined;
  const requestStartedAt = now();
  const response = await fetchFn(input, init);
  if (measurementAtStart) {
    const decoded = await response.clone().arrayBuffer();
    assert.ok(decoded.byteLength <= 1024 * 1024, 'Unexpected MCP response size');
    measurementAtStart.decodedResponseBytes += decoded.byteLength;
    measurementAtStart.responseCount += 1;
    measurementAtStart.elapsedMs += now() - requestStartedAt;
  }
  return response;
}

const roundedAverage = (values: number[]) => Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);

export function summarizeToolHttpSamples(samples: ToolHttpSample[]) {
  assert.ok(samples.length > 0, 'No tool HTTP measurements');
  for (const sample of samples) {
    assert.ok(Number.isFinite(sample.startedAt) && sample.startedAt >= 0);
    assert.ok(Number.isFinite(sample.elapsedMs) && sample.elapsedMs >= 0);
    assert.ok(Number.isSafeInteger(sample.decodedResponseBytes) && sample.decodedResponseBytes >= 0);
  }
  const starts = samples.map(sample => sample.startedAt).sort((a, b) => a - b);
  let left = 0, maxCallsInOneMinute = 0;
  for (let right = 0; right < starts.length; right += 1) {
    while (starts[right] - starts[left] >= 60_000) left += 1;
    maxCallsInOneMinute = Math.max(maxCallsInOneMinute, right - left + 1);
  }
  assert.ok(maxCallsInOneMinute < 60, 'Tool call rate exceeded');
  const latencies = samples.map(sample => sample.elapsedMs);
  const bytes = samples.map(sample => sample.decodedResponseBytes);
  return {
    callCount: samples.length,
    maxCallsInOneMinute,
    clientHttpLatencyMs: { min: Math.min(...latencies), max: Math.max(...latencies), average: roundedAverage(latencies) },
    decodedHttpResponseBytes: { total: bytes.reduce((sum, value) => sum + value, 0), min: Math.min(...bytes), max: Math.max(...bytes), average: roundedAverage(bytes) },
    envelopeNote: 'Os bytes incluem o envelope MCP com conteúdo textual e estruturado duplicado; não representam egress faturado pelo Supabase.',
  };
}
