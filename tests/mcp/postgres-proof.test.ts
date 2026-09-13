import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  assertPostgresBusinessResult,
  assertLiveAccessResult,
  assertProductionProjection,
  fetchWithToolCallMeasurement,
  firstRowFromPagedRead,
  parseProofConsentRedirect,
  postgresPilotProofGuard,
  stockSkuFromProofResult,
  summarizeToolHttpSamples,
} from '../../scripts/lib/mcp-postgres-proof';

const userId = 'staging-proof-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const hash = 'a'.repeat(64);
const now = Date.parse('2026-09-12T12:00:00.000Z');
const validPilot = {
  MCP_PG_PILOT_VERIFY: 'true',
  MCP_PG_PILOT_ENABLED: 'true',
  MCP_PG_PILOT_USER_IDS: userId,
  MCP_PG_PILOT_SNAPSHOT_HASH: hash,
  MCP_PG_PILOT_EXPIRES_AT: '2026-09-13T11:59:59.000Z',
};

it('loads the executable entrypoint and refuses an empty environment before network work', () => {
  const run = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/mcp-staging-proof.ts', '--preflight-only'], {
    cwd: fileURLToPath(new URL('../..', import.meta.url)),
    env: { NODE_ENV: 'test' },
    encoding: 'utf8',
  });
  expect(run.status).toBe(1);
  expect(run.stdout).toBe('');
  expect(JSON.parse(run.stderr)).toMatchObject({ proof: 'refused', network: false, hostedClaude: false });
});

describe('PostgreSQL pilot proof preflight', () => {
  it('preserves Firestore mode only when verification is missing or exactly false', () => {
    expect(postgresPilotProofGuard({}, userId, now)).toEqual({ enabled: false, errors: [] });
    expect(postgresPilotProofGuard({ MCP_PG_PILOT_VERIFY: 'false' }, userId, now)).toEqual({ enabled: false, errors: [] });
    expect(postgresPilotProofGuard({ MCP_PG_PILOT_VERIFY: 'TRUE' }, userId, now).errors).toEqual([
      'MCP_PG_PILOT_VERIFY must be missing, false or true.',
    ]);
  });

  it('accepts one exact proof user, a lower-hex hash and an expiry within 24 hours', () => {
    expect(postgresPilotProofGuard(validPilot, userId, now)).toEqual({
      enabled: true,
      errors: [],
      snapshotHash: hash,
      expiresAt: '2026-09-13T11:59:59.000Z',
    });
  });

  it.each([
    ['disabled runtime selector', { MCP_PG_PILOT_ENABLED: 'false' }],
    ['more than the proof user', { MCP_PG_PILOT_USER_IDS: `${userId},other` }],
    ['upper-case snapshot hash', { MCP_PG_PILOT_SNAPSHOT_HASH: 'A'.repeat(64) }],
    ['expired window', { MCP_PG_PILOT_EXPIRES_AT: '2026-09-12T12:00:00.000Z' }],
    ['window beyond 24 hours', { MCP_PG_PILOT_EXPIRES_AT: '2026-09-13T12:00:00.001Z' }],
  ])('rejects %s before remote work', (_label, override) => {
    expect(postgresPilotProofGuard({ ...validPilot, ...override }, userId, now).errors.length).toBeGreaterThan(0);
  });
});

describe('shared OAuth provider redirect', () => {
  const authorizationId = 'sq3ajqf4ksqdun6yxstzoxwec5d7br2p';
  const staging = `https://br-steel-mcp-staging.vercel.app/oauth/consent?authorization_id=${authorizationId}`;
  const production = `https://br-steel.vercel.app/oauth/consent?authorization_id=${authorizationId}`;

  it('preserves the staging-only redirect contract in Firestore mode', () => {
    expect(parseProofConsentRedirect(staging, false)).toEqual({
      authorizationId,
      stagingPath: `/oauth/consent?authorization_id=${authorizationId}`,
      sharedProviderProductionRedirect: false,
    });
    expect(() => parseProofConsentRedirect(production, false)).toThrow('Unexpected OAuth consent redirect');
  });

  it('recognizes only the exact production consent redirect in pilot mode and routes it to staging', () => {
    expect(parseProofConsentRedirect(production, true)).toEqual({
      authorizationId,
      stagingPath: `/oauth/consent?authorization_id=${authorizationId}`,
      sharedProviderProductionRedirect: true,
    });
    for (const unsafe of [
      `https://br-steel.vercel.app/oauth/other?authorization_id=${authorizationId}`,
      `https://br-steel.vercel.app/oauth/consent?authorization_id=${authorizationId}&next=https://example.test`,
      'https://br-steel.vercel.app/oauth/consent?authorization_id=../../secret',
      `https://user@br-steel.vercel.app/oauth/consent?authorization_id=${authorizationId}`,
      `https://attacker.test/oauth/consent?authorization_id=${authorizationId}`,
    ]) expect(() => parseProofConsentRedirect(unsafe, true)).toThrow('Unexpected OAuth consent redirect');
  });
});

describe('PostgreSQL MCP result evidence', () => {
  const readCopy = {
    mode: 'pilot',
    sourceProject: 'marketflow-9h4tg',
    snapshotHash: hash,
    capturedAt: '2026-09-12T10:00:00.000Z',
    completedAt: '2026-09-12T10:05:00.000Z',
  };
  const result = {
    data: [{ id: 'real-row-kept-only-in-memory' }],
    source: 'postgres',
    asOf: readCopy.capturedAt,
    warnings: ['Leitura de cópia de piloto capturada para conferência; não representa dados atuais do sistema.'],
    nextCursor: null,
    readCopy,
  };

  it('accepts the complete copy contract and returns metadata without the business payload', () => {
    expect(assertPostgresBusinessResult(result, hash)).toEqual(readCopy);
  });

  it('keeps consultar_meu_acesso live and refuses copy metadata on it', () => {
    expect(() => assertLiveAccessResult({ data: { role: 'Administrador' }, source: 'firestore', asOf: '2026-09-12T12:00:00.000Z', warnings: [], nextCursor: null })).not.toThrow();
    expect(() => assertLiveAccessResult({ ...result, data: { role: 'Administrador' } })).toThrow('Invalid live access response');
  });

  it.each([
    ['source', { source: 'firestore' }],
    ['asOf', { asOf: '2026-09-12T10:00:01.000Z' }],
    ['warning', { warnings: ['Dados atuais.'] }],
    ['source project', { readCopy: { ...readCopy, sourceProject: 'other-project' } }],
    ['snapshot hash', { readCopy: { ...readCopy, snapshotHash: 'b'.repeat(64) } }],
    ['completion order', { readCopy: { ...readCopy, completedAt: '2026-09-12T09:59:59.000Z' } }],
    ['cursor shape', { nextCursor: 7 }],
  ])('rejects a mismatched %s', (_label, override) => {
    expect(() => assertPostgresBusinessResult({ ...result, ...override }, hash)).toThrow('Invalid PostgreSQL pilot response');
  });

  it('rejects financial and client fields anywhere in production projections', () => {
    expect(() => assertProductionProjection([{ sku: 'A', nested: { customerName: 'private' } }])).toThrow('Restricted production projection');
    expect(() => assertProductionProjection({ data: [{ sku: 'A', valor: 100 }] })).toThrow('Restricted production projection');
    expect(() => assertProductionProjection({ data: [{ sku: 'A', contato: { nome: 'private' } }] })).toThrow('Restricted production projection');
    expect(() => assertProductionProjection({ data: [{ sku: 'A', customerName: '' }] })).not.toThrow();
    expect(() => assertProductionProjection({ data: [{ sku: 'A', totalQuantitySold: 2, stockLevel: 0 }] })).not.toThrow();
  });

  it('takes the stock drilldown SKU from the projected produto.codigo field', () => {
    expect(stockSkuFromProofResult({ produto: { codigo: 'SKU-123' } })).toBe('SKU-123');
    for (const invalid of [{ sku: 'wrong-level' }, { produto: {} }, { produto: { codigo: '' } }]) {
      expect(() => stockSkuFromProofResult(invalid)).toThrow('Stock result has no safe SKU');
    }
  });

  it('advances through bounded empty supply pages before selecting a real row', async () => {
    const seen: Array<string | undefined> = [];
    const row = await firstRowFromPagedRead(async cursor => {
      seen.push(cursor);
      if (!cursor) return { data: [], nextCursor: 'page-2' };
      return { data: [{ id: 'supply-id' }], nextCursor: null };
    }, 3);
    expect(row).toEqual({ id: 'supply-id' });
    expect(seen).toEqual([undefined, 'page-2']);
    await expect(firstRowFromPagedRead(async () => ({ data: [], nextCursor: 'same' }), 2)).rejects.toThrow('No row found within page bound');
  });

  it('exercises one supplied cursor after selecting a nonempty supply page', async () => {
    const seen: Array<string | undefined> = [];
    const row = await firstRowFromPagedRead(async cursor => {
      seen.push(cursor);
      return cursor
        ? { data: [{ id: 'next-supply' }], nextCursor: null }
        : { data: [{ id: 'selected-supply' }], nextCursor: 'page-2' };
    }, 2);
    expect(row).toEqual({ id: 'selected-supply' });
    expect(seen).toEqual([undefined, 'page-2']);
  });

  it('finds the only named supply after 53 omitted source rows within the scan bound', async () => {
    const source = Array.from({ length: 54 }, (_, index) => ({
      id: `supply-${index + 1}`,
      ...(index === 53 ? { nome: 'Named supply' } : {}),
    }));
    const pageSizes: number[] = [];
    const row = await firstRowFromPagedRead(async (cursor, pageSize) => {
      pageSizes.push(pageSize);
      const offset = cursor ? Number(cursor) : 0;
      const scanned = source.slice(offset, offset + pageSize);
      return {
        data: scanned.filter(item => item.nome),
        nextCursor: offset + pageSize < source.length ? String(offset + pageSize) : null,
      };
    }, 10, 10);
    expect(row).toEqual({ id: 'supply-54', nome: 'Named supply' });
    expect(pageSizes).toEqual([10, 10, 10, 10, 10, 10]);
  });

  it('records bounded aggregate HTTP measurements without response content or tool names', () => {
    const samples = [
      { startedAt: now, elapsedMs: 20, decodedResponseBytes: 120 },
      { startedAt: now + 30_000, elapsedMs: 40, decodedResponseBytes: 80 },
      { startedAt: now + 60_000, elapsedMs: 10, decodedResponseBytes: 40 },
    ];
    expect(summarizeToolHttpSamples(samples)).toEqual({
      callCount: 3,
      maxCallsInOneMinute: 2,
      clientHttpLatencyMs: { min: 10, max: 40, average: 23 },
      decodedHttpResponseBytes: { total: 240, min: 40, max: 120, average: 80 },
      envelopeNote: 'Os bytes incluem o envelope MCP com conteúdo textual e estruturado duplicado; não representam egress faturado pelo Supabase.',
    });
    expect(JSON.stringify(summarizeToolHttpSamples(samples))).not.toContain('real-row');
    expect(() => summarizeToolHttpSamples(Array.from({ length: 60 }, (_, index) => ({
      startedAt: now + index,
      elapsedMs: 1,
      decodedResponseBytes: 1,
    })))).toThrow('Tool call rate exceeded');
    expect(() => summarizeToolHttpSamples([
      ...Array.from({ length: 59 }, (_, index) => ({ startedAt: now + 59_900 + index, elapsedMs: 1, decodedResponseBytes: 1 })),
      { startedAt: now + 60_001, elapsedMs: 1, decodedResponseBytes: 1 },
    ])).toThrow('Tool call rate exceeded');
  });

  it('attributes only a tools/call POST captured at request start while an auxiliary GET overlaps', async () => {
    let releaseGet!: () => void;
    const getGate = new Promise<void>(resolve => { releaseGet = resolve; });
    const fetchMock: typeof fetch = async (_input, init) => {
      if (init?.method === 'GET') {
        await getGate;
        return new Response('auxiliary stream ended', { status: 200 });
      }
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 7, result: { ok: true } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };
    const measurement = { startedAt: now, elapsedMs: 0, decodedResponseBytes: 0, responseCount: 0 };
    let active: typeof measurement | undefined;
    const measured = (init: RequestInit) => fetchWithToolCallMeasurement(
      'https://br-steel-mcp-staging.vercel.app/api/mcp', init,
      'https://br-steel-mcp-staging.vercel.app/api/mcp', active, fetchMock,
    );

    const auxiliary = measured({ method: 'GET' });
    active = measurement;
    const tool = measured({ method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'listar_pedidos' } }) });
    await tool;
    releaseGet();
    await auxiliary;

    expect(measurement.responseCount).toBe(1);
    expect(measurement.decodedResponseBytes).toBeGreaterThan(0);
    expect(measurement.elapsedMs).toBeGreaterThanOrEqual(0);
  });
});
