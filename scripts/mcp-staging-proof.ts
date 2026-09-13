#!/usr/bin/env node
// Run only with an explicitly supplied clean staging environment:
// node --import tsx scripts/mcp-staging-proof.ts [--preflight-only]
// No local env files, server-only overrides, application imports or ADC fallback.
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID, scryptSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Firestore } from 'firebase-admin/firestore';
import { createClient } from '@supabase/supabase-js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { discoverOAuthProtectedResourceMetadata, discoverAuthorizationServerMetadata } from '@modelcontextprotocol/sdk/client/auth.js';
import { STAGING, stagingProofGuard, verifyStagingProofJwt } from './lib/mcp-staging-proof-guard';
import { assertLiveAccessResult, assertPostgresBusinessResult, assertProductionProjection, fetchWithToolCallMeasurement,
  firstRowFromPagedRead, parseProofConsentRedirect, postgresPilotProofGuard, stockSkuFromProofResult,
  summarizeToolHttpSamples } from './lib/mcp-postgres-proof';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const LIMIT_MS = 10 * 60 * 1000;
const REQUEST_MS = 25_000;
const MAX_SCOPED_ROWS = 100;

async function main() {
  const args = process.argv.slice(2);
  assert.ok(args.length === 0 || (args.length === 1 && args[0] === '--preflight-only'));
  const config = JSON.parse(readFileSync(new URL('../config/vercel.mcp-staging.json', import.meta.url), 'utf8'));
  const guard = stagingProofGuard(process.env, config);
  const pilot = postgresPilotProofGuard(process.env, guard.userId);
  const guardErrors = [...guard.errors, ...pilot.errors];
  if (guardErrors.length) {
    console.error(JSON.stringify({ proof: 'refused', guardErrors, network: false, hostedClaude: false }, null, 2));
    process.exitCode = 1; return;
  }
  if (args[0] === '--preflight-only') {
    console.log(JSON.stringify({ proof: 'offline-preflight-only', targets: STAGING, network: false, hostedClaude: false,
      ...(pilot.enabled ? { postgresPilot: { enabled: true, sourceProject: 'marketflow-9h4tg',
        snapshotHash: pilot.snapshotHash, expiresAt: pilot.expiresAt } } : {}) }, null, 2));
    return;
  }
  const startedAt = Date.now(), runId = randomUUID(), userId = guard.userId;
  const email = `${userId}@example.invalid`, password = randomBytes(32).toString('base64url');
  const clientName = `BR Steel staging proof ${runId}`;
  // This URI receives no HTTP request. The harness inspects the provider's redirect in memory.
  const callback = `${STAGING.origin}/oauth/proof-callback/${runId}`;
  const db = new Firestore({ projectId: STAGING.firebase, databaseId: '(default)',
    credentials: { client_email: guard.credential!.client_email, private_key: guard.credential!.private_key },
    preferRest: true, maxIdleChannels: 0 });
  const ownedDocs = new Map<string, { confirmed: boolean }>();
  const ownedClientIds = new Set<string>(), intentIds = new Set<string>(), rateMinutes = new Set<number>();
  const secrets = new Set([password]);
  const cookies = new Map<string, string>();
  const pendingOwned = new Set<string>();
  const cleanupIssues = new Set<string>();
  const evidence: Record<string, unknown> = { checkedAt: new Date(startedAt).toISOString(), targets: STAGING,
    ...(!pilot.enabled ? { userId, syntheticRunId: runId } : {}), hostedClaude: false, writesEnabled: false,
    ...(pilot.enabled ? { postgresPilot: { enabled: true, sourceProject: 'marketflow-9h4tg', dataPeriod: { from: '2026-09-01', to: '2026-09-12' } } } : {}) };
  let stage = 'staging-read-only-preflight', failedStage: string | undefined, userCreated = false;
  let clientId: string | undefined, registrationAttempted = false, ambiguousRequest = false;
  let cleaning = false, lastHttpStatus: number | undefined;
  let mcpClient: Client | undefined;
  let lastToolName: string | undefined;
  let sharedProviderProductionRedirect = false;
  const toolHttpSamples: Array<{ startedAt: number; elapsedMs: number; decodedResponseBytes: number }> = [];
  let activeToolMeasurement: { startedAt: number; elapsedMs: number; decodedResponseBytes: number; responseCount: number } | undefined;
  function progress(next: string) {
    stage = next;
    console.log(JSON.stringify({ proofStage: next, hostedClaude: false }));
    assert.ok(cleaning || Date.now() - startedAt < LIMIT_MS, 'Proof time budget exceeded');
  }
  function own(path: string) { pendingOwned.add(path); }
  function safeUrl(input: RequestInfo | URL) {
    const url = new URL(input instanceof Request ? input.url : String(input));
    assert.ok([STAGING.origin, STAGING.supabaseUrl].includes(url.origin as typeof STAGING.origin));
    assert.ok(url.protocol === 'https:' && !url.username && !url.password && !url.hash);
    if (url.origin === STAGING.supabaseUrl) assert.ok(url.pathname.startsWith('/auth/v1/') || url.pathname.startsWith('/.well-known/'));
    return url;
  }
  // Shared by the official SDK and Supabase admin client; redirect following is always disabled.
  const guardedFetch: typeof fetch = async (input, init = {}) => {
    const url = safeUrl(input);
    assert.ok(cleaning || Date.now() - startedAt < LIMIT_MS, 'Proof time budget exceeded');
    const isMcp = url.href === STAGING.resource && Boolean(clientId);
    const markMinute = () => {
      const minute = Math.floor(Date.now() / 60000);
      for (const offset of [-1, 0, 1]) rateMinutes.add(minute + offset);
    };
    if (isMcp) markMinute();
    const inheritedSignal = init.signal ?? (input instanceof Request ? input.signal : undefined);
    const signal = AbortSignal.any([AbortSignal.timeout(REQUEST_MS), ...(inheritedSignal ? [inheritedSignal] : [])]);
    try {
      const response = await fetchWithToolCallMeasurement(input, { ...init, signal, redirect: 'manual' },
        STAGING.resource, activeToolMeasurement, fetch);
      lastHttpStatus = response.status;
      return response;
    } catch {
      // A timed-out HTTP mutation can still finish on the server. Never claim certain cleanup then.
      ambiguousRequest = true;
      throw new Error('Guarded HTTPS request failed');
    } finally { if (isMcp) markMinute(); }
  };
  const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: guardedFetch } };
  const admin = createClient(STAGING.supabaseUrl, process.env.SUPABASE_SECRET_KEY!, options);
  const publicAuth = createClient(STAGING.supabaseUrl, process.env.SUPABASE_PUBLISHABLE_KEY!, options);
  async function http(url: string, init: RequestInit = {}) {
    const response = await guardedFetch(url, init);
    const body = await response.text();
    assert.ok(body.length <= 1024 * 1024, 'Unexpected response size');
    let data: any = null;
    try { data = JSON.parse(body); } catch { /* HTML redirects/pages need no parsing. */ }
    return { response, data };
  }
  async function app(path: string, method = 'GET', body?: unknown, withCookies = true, origin: string = STAGING.origin) {
    assert.ok(path.startsWith('/') && !path.startsWith('//'));
    const result = await http(`${STAGING.origin}${path}`, { method,
      headers: { origin, 'content-type': 'application/json', cookie: withCookies ? [...cookies].map(([k, v]) => `${k}=${v}`).join('; ') : '' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (withCookies) for (const item of result.response.headers.getSetCookie()) {
      const pair = item.split(';')[0], split = pair.indexOf('=');
      const key = pair.slice(0, split), value = pair.slice(split + 1);
      if (value) { cookies.set(key, value); secrets.add(value); } else cookies.delete(key);
    }
    return result;
  }
  async function createOwned(collection: string, key: string, data: Record<string, unknown>) {
    const ref = db.collection(collection).doc(key);
    assert.ok(!(await ref.get()).exists, 'Synthetic ID already exists');
    ownedDocs.set(ref.path, { confirmed: false });
    await ref.create({ ...data, stagingProofRunId: runId });
    ownedDocs.get(ref.path)!.confirmed = true; own(ref.path);
  }
  async function scoped(collection: string) {
    const rows = await db.collection(collection).where('userId', '==', userId).limit(MAX_SCOPED_ROWS + 1).get();
    assert.ok(rows.size <= MAX_SCOPED_ROWS, 'Scoped cleanup bound exceeded');
    return rows.docs;
  }
  async function setRole(role: string) {
    await db.runTransaction(async tx => {
      const ref = db.collection('users').doc(userId), snap = await tx.get(ref);
      assert.equal(snap.data()?.stagingProofRunId, runId);
      tx.update(ref, { role });
    });
  }
  async function setActive(active: boolean) {
    await db.runTransaction(async tx => {
      const ref = db.collection('users').doc(userId), snap = await tx.get(ref);
      assert.equal(snap.data()?.stagingProofRunId, runId);
      tx.update(ref, { active });
    });
  }
  function tokens(data: any) {
    assert.ok(typeof data?.access_token === 'string' && typeof data?.refresh_token === 'string');
    assert.equal(String(data.token_type).toLowerCase(), 'bearer');
    secrets.add(data.access_token); secrets.add(data.refresh_token);
    return { access_token: data.access_token as string, refresh_token: data.refresh_token as string };
  }
  async function mcpStatus(token?: string) {
    const response = await guardedFetch(STAGING.resource, { headers: token ? { authorization: `Bearer ${token}` } : {} });
    await response.arrayBuffer(); return response;
  }
  try {
    // Reject collisions and any persisted ERP connection without changing either.
    assert.ok(!(await db.collection('appConfig').doc('blingCredentials').get()).exists, 'Dedicated staging must have no saved Bling credentials');
    assert.ok(!(await db.collection('users').doc(userId).get()).exists);
    assert.ok(!(await db.collection('mcpIdentityBindings').doc(sha(userId)).get()).exists);
    for (const collection of ['mcpConnections', 'mcpAuthorizationIntents', 'mcpIdentities', 'mcpAuditLogs']) assert.equal((await scoped(collection)).length, 0);
    for (const field of ['email', 'normalizedEmail']) assert.ok((await db.collection('users').where(field, '==', email).limit(1).get()).empty);
    assert.ok((await db.collection('salesOrders').where('data', '>=', '2071-08-30').where('data', '<=', '2071-09-02').limit(1).get()).empty, 'Synthetic comparison period must be empty');

    progress('https-sdk-discovery');
    const prm = await discoverOAuthProtectedResourceMetadata(STAGING.resource, {}, guardedFetch);
    assert.equal(prm.resource, STAGING.resource); assert.deepEqual(prm.authorization_servers, [STAGING.issuer]);
    const metadata = await discoverAuthorizationServerMetadata(STAGING.issuer, { fetchFn: guardedFetch });
    assert.equal(metadata?.issuer, STAGING.issuer);
    assert.ok(metadata?.code_challenge_methods_supported?.includes('S256'));
    for (const endpoint of [metadata!.authorization_endpoint, metadata!.token_endpoint, metadata!.registration_endpoint]) {
      assert.ok(endpoint); const url = safeUrl(endpoint!); assert.equal(url.origin, STAGING.supabaseUrl);
    }
    // Fetch once from the exact project, never from a JWT jku/x5u or arbitrary metadata URL.
    const jwksResponse = await http(STAGING.jwks); assert.equal(jwksResponse.response.status, 200);
    const jwks = jwksResponse.data;
    const anonymous = await mcpStatus(); assert.equal(anonymous.status, 401);
    assert.ok(anonymous.headers.get('www-authenticate')?.includes(`${STAGING.origin}/.well-known/oauth-protected-resource/api/mcp`));
    assert.equal(anonymous.headers.get('cache-control'), 'no-store');

    async function begin() {
      const verifier = randomBytes(48).toString('base64url'), state = randomUUID();
      secrets.add(verifier);
      const query = new URLSearchParams({ response_type: 'code', client_id: clientId!, redirect_uri: callback,
        scope: 'openid email profile offline_access', resource: STAGING.resource, state,
        code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' });
      const result = await http(`${metadata!.authorization_endpoint}?${query}`);
      assert.equal(result.response.status, 302);
      const routing = parseProofConsentRedirect(result.response.headers.get('location')!, pilot.enabled);
      const id = routing.authorizationId;
      sharedProviderProductionRedirect ||= routing.sharedProviderProductionRedirect;
      intentIds.add(id);
      return { id, verifier, state, path: routing.stagingPath };
    }
    async function prepare(request: Awaited<ReturnType<typeof begin>>) {
      const session = await app('/api/mcp-auth/session', 'POST', { authorization_id: request.id,
        userId: 'not-the-authenticated-user', email: 'untrusted@example.invalid' });
      assert.equal(session.response.status, 200); assert.deepEqual(session.data, { ok: true });
      const cookie = session.response.headers.getSetCookie().find(item => item.startsWith('brsteel_oauth_session='));
      assert.ok(cookie?.includes('HttpOnly') && cookie.includes('SameSite=Lax') && cookie.includes('Secure'));
      assert.equal(cookies.get('brsteel_oauth_session')?.split('.').length, 5);
      const details = await app(`/api/mcp-auth/authorization?authorization_id=${request.id}`);
      assert.equal(details.response.status, 200); assert.equal(details.data.authorization.client.id, clientId);
      assert.equal(details.data.authorization.redirect_uri, callback); assert.equal(details.data.user.email, email);
      assert.ok(details.data.capabilities.some((item: any) => item.key === 'vendas:read'));
      assert.ok(details.data.capabilities.every((item: any) => item.write === false));
    }
    async function decide(request: Awaited<ReturnType<typeof begin>>, decision = 'approve') {
      const result = await app('/api/mcp-auth/decision', 'POST', { authorization_id: request.id, decision,
        capabilities: decision === 'approve' ? ['vendas:read', 'estoque:read', 'insumos:read', 'producao:read'] : [] });
      assert.equal(result.response.status, 200);
      const url = new URL(result.data.redirectUrl);
      assert.equal(`${url.origin}${url.pathname}`, callback); assert.equal(url.searchParams.get('state'), request.state);
      return url;
    }
    async function exchange(request: Awaited<ReturnType<typeof begin>>, url: URL) {
      const code = url.searchParams.get('code'); assert.ok(code); secrets.add(code);
      const body = new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId!, redirect_uri: callback,
        code_verifier: request.verifier, code, resource: STAGING.resource });
      const result = await http(metadata!.token_endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
      assert.equal(result.response.status, 200);
      return tokens(result.data);
    }
    async function refresh(token: string) {
      return http(metadata!.token_endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'refresh_token', client_id: clientId!, refresh_token: token, resource: STAGING.resource }) });
    }

    progress('create-owned-synthetic-user-and-dcr-client');
    const salt = randomBytes(16).toString('base64url');
    await createOwned('users', userId, { name: 'Teste sintético MCP staging', email, normalizedEmail: email,
      role: 'Administrador', active: true, authVersion: 0, mustChangePassword: true,
      passwordHash: scryptSync(password, salt, 64).toString('base64url'), passwordSalt: salt });
    userCreated = true;
    registrationAttempted = true;
    const registration = await http(metadata!.registration_endpoint!, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_name: clientName, client_uri: callback, redirect_uris: [callback],
        grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' }) });
    assert.equal(registration.response.status, 201); assert.match(registration.data?.client_id, uuid);
    clientId = registration.data.client_id; ownedClientIds.add(clientId!); own(`supabase/oauthClients/${clientId}`);
    const request = await begin();
    const anonymousPage = await app(request.path, 'GET', undefined, false);
    assert.equal(anonymousPage.response.status, 307);
    const loginUrl = new URL(anonymousPage.response.headers.get('location')!, STAGING.origin);
    assert.equal(loginUrl.origin, STAGING.origin); assert.equal(loginUrl.pathname, '/login'); assert.equal(loginUrl.searchParams.get('next'), request.path);
    assert.equal((await app('/api/mcp-auth/session', 'POST', { authorization_id: request.id }, false)).response.status, 401);

    progress('https-login-first-access-consent-pkce');
    const login = await app('/api/auth/login', 'POST', { email, password });
    assert.equal(login.response.status, 200); assert.equal(login.data.user.mustChangePassword, true);
    const loginCookie = login.response.headers.getSetCookie().find(item => item.startsWith('brsteel_session='));
    assert.ok(loginCookie?.includes('HttpOnly') && loginCookie.includes('Secure') && loginCookie.includes('SameSite=Lax'));
    assert.equal((await app('/api/mcp-auth/session', 'POST', { authorization_id: request.id }, true, 'https://untrusted.example.invalid')).response.status, 403);
    const setupPage = await app(request.path); assert.equal(setupPage.response.status, 307);
    const setupUrl = new URL(setupPage.response.headers.get('location')!, STAGING.origin);
    assert.equal(setupUrl.origin, STAGING.origin); assert.equal(setupUrl.pathname, '/perfil'); assert.equal(setupUrl.searchParams.get('next'), request.path);
    assert.equal((await app('/api/mcp-auth/session', 'POST', { authorization_id: request.id })).response.status, 403);
    const personalPassword = randomBytes(32).toString('base64url'); secrets.add(personalPassword);
    const setup = await app('/api/auth/profile', 'PATCH', { name: 'Teste sintético MCP staging', newPassword: personalPassword });
    assert.equal(setup.response.status, 200); assert.equal(setup.data.user.mustChangePassword, false);
    await prepare(request);
    const binding = await db.collection('mcpIdentityBindings').doc(sha(userId)).get();
    assert.equal(binding.data()?.userId, userId); const sub = binding.data()?.sub as string; assert.match(sub, uuid);
    own(binding.ref.path); own(`mcpIdentities/${sub}`); own(`supabase/users/${sub}`);
    const link = await admin.auth.admin.generateLink({ type: 'magiclink', email });
    assert.equal(link.error, null); assert.equal(link.data.user.id, sub);
    const normal = await publicAuth.auth.verifyOtp({ type: 'magiclink', token_hash: link.data.properties.hashed_token });
    assert.equal(normal.error, null); assert.equal(normal.data.user?.id, sub); assert.ok(normal.data.session);
    secrets.add(normal.data.session.access_token); secrets.add(normal.data.session.refresh_token);
    const normalJwt = await verifyStagingProofJwt(normal.data.session.access_token, jwks, { sub });
    assert.equal((await mcpStatus(normal.data.session.access_token)).status, 401);
    assert.equal((await publicAuth.auth.signOut({ scope: 'local' })).error, null);
    const issued = await exchange(request, await decide(request));
    const codeJwt = await verifyStagingProofJwt(issued.access_token, jwks, { sub, clientId });
    evidence.oauth = { realHttps: true, discoveryDcrLoginConsentCode: true, pkceS256: true,
      firstAccessAndSafeReturn: true, normalProviderSessionRejected: true,
      ...(pilot.enabled ? { sharedProviderRouting: { productionConsentRedirectRecognized: sharedProviderProductionRedirect,
        authorizationSubmittedToDedicatedStagingSession: true, fullBrowserRedirectUxVerified: false } } : {}),
      independentJwt: { jwksPinnedToDedicatedProject: true, normalSession: normalJwt, authorizationCode: codeJwt } };

    progress('official-mcp-sdk-three-role-read-proof');
    const saleId = Number.parseInt(randomBytes(6).toString('hex'), 16), sku = `MCP-STAGING-${runId}`;
    if (!pilot.enabled) {
      for (const [offset, data, total, quantidade] of [[0, '2071-09-01', 100, 2], [1, '2071-09-02', 200, 4], [2, '2071-08-31', 150, 3]] as const) {
        await createOwned('salesOrders', `staging-proof-${runId}-sale-${offset}`, { id: saleId + offset, numero: saleId + offset, data, total,
          contato: { id: saleId, nome: 'PRIVATE-STAGING-CUSTOMER', numeroDocumento: 'PRIVATE-STAGING-DOCUMENT' },
          notaFiscal: { id: saleId + offset, xml: 'PRIVATE-STAGING-XML' },
          itens: [{ id: saleId + offset, codigo: sku, descricao: 'Chapa sintética staging', quantidade, valor: 50, unidade: 'UN' }] });
      }
      await createOwned('stockUpdates', sku, { sku, nome: 'Chapa sintética staging', estoqueAtual: 0, webhookReceivedAt: new Date().toISOString() });
    }
    mcpClient = new Client({ name: `br-steel-staging-proof-${runId}`, version: '1.0.0' });
    await mcpClient.connect(new StreamableHTTPClientTransport(new URL(STAGING.resource), {
      fetch: guardedFetch, requestInit: { headers: { authorization: `Bearer ${issued.access_token}` } } }));
    const roles: Record<string, string[]> = {};
    const sales = ['listar_pedidos', 'consultar_pedido', 'resumir_vendas'];
    const supplies = ['listar_insumos', 'listar_movimentacoes_insumo'];
    const production = ['consultar_demanda_producao', 'listar_pedidos_para_producao', 'listar_colunas_producao', 'listar_lotes_producao', 'consultar_lote_producao'];
    const allToolNames = new Set(['consultar_meu_acesso', 'consultar_estoque_produtos', ...sales, ...supplies, ...production]);
    const productionTools = new Set(production);
    let copyMetadata: ReturnType<typeof assertPostgresBusinessResult> | undefined;
    async function invoke(name: string, args: Record<string, unknown> = {}) {
      assert.ok(allToolNames.has(name)); lastToolName = name;
      assert.equal(activeToolMeasurement, undefined);
      activeToolMeasurement = { startedAt: Date.now(), elapsedMs: 0, decodedResponseBytes: 0, responseCount: 0 };
      try { return await mcpClient!.callTool({ name, arguments: args }, undefined, { timeout: REQUEST_MS }); }
      finally {
        const measurement = activeToolMeasurement;
        activeToolMeasurement = undefined;
        assert.ok(measurement);
        assert.equal(measurement.responseCount, 1, 'Expected one decoded HTTPS response per tool call');
        toolHttpSamples.push({ startedAt: measurement.startedAt, elapsedMs: measurement.elapsedMs,
          decodedResponseBytes: measurement.decodedResponseBytes });
        summarizeToolHttpSamples(toolHttpSamples);
      }
    }
    async function call(name: string, args: Record<string, unknown> = {}) {
      const result = await invoke(name, args);
      assert.ok(!result.isError); assert.ok(result.structuredContent);
      assert.ok(Array.isArray(result.content));
      const text = result.content.filter((item: any): item is { type: 'text'; text: string } => item?.type === 'text' && typeof item.text === 'string');
      assert.equal(text.length, 1); assert.deepEqual(JSON.parse(text[0].text), result.structuredContent);
      const output = result.structuredContent as { data: any; source: string; asOf: string; warnings: string[];
        nextCursor: string | null; readCopy?: unknown };
      if (name === 'consultar_meu_acesso') assertLiveAccessResult(output);
      else if (pilot.enabled) {
        const metadata = assertPostgresBusinessResult(output, pilot.snapshotHash!);
        if (copyMetadata) assert.deepEqual(metadata, copyMetadata); else copyMetadata = metadata;
        if (productionTools.has(name)) assertProductionProjection(output.data);
      }
      return output;
    }
    async function deniedTool(name: string, args: Record<string, unknown> = {}) {
      assert.equal((await invoke(name, args)).isError, true);
    }
    async function paged(name: string, args: Record<string, unknown>) {
      const first = await call(name, args);
      if (first.nextCursor) await call(name, { ...args, cursor: first.nextCursor });
      return first;
    }
    for (const role of ['Administrador', 'Vendedor', 'Operador']) {
      lastToolName = undefined;
      await setRole(role);
      const tools = (await mcpClient.listTools()).tools;
      assert.ok(tools.every(tool => tool.annotations?.readOnlyHint === true && tool.annotations?.destructiveHint === false));
      roles[role] = tools.map(tool => tool.name).sort();
      const expected = ['consultar_meu_acesso', 'consultar_estoque_produtos', ...(role === 'Operador' ? [] : sales),
        ...(role === 'Vendedor' ? [] : supplies), ...(role === 'Vendedor' ? [] : production)].sort();
      assert.deepEqual(roles[role], expected);
      assert.equal((await call('consultar_meu_acesso')).data.role, role);
      if (!pilot.enabled && role !== 'Operador') {
        const summary = await call('resumir_vendas', { from: '2071-09-01', to: '2071-09-02' });
        assert.equal(summary.data.totalRevenue, 300); assert.equal(summary.data.stats.totalRevenue.change, 100);
      }
      const stock = await call('consultar_estoque_produtos', pilot.enabled ? { limit: 1 } : { sku });
      if (!pilot.enabled) {
        assert.equal(stock.data.length, 1); assert.equal(stock.source, 'firestore');
        assert.equal(stock.data[0].saldoVirtualTotal, 0); assert.equal(stock.data[0].saldoFisicoTotal, null); assert.equal(stock.data[0].source, 'firestore');
        assert.ok(!stock.warnings.some(warning => warning.includes('Bling indisponível')));
      }
      if (role === 'Operador') {
        await deniedTool('listar_pedidos');
        const demand = await call('consultar_demanda_producao', pilot.enabled
          ? { from: '2026-09-01', to: '2026-09-12', limit: 1 }
          : { from: '2071-09-01', to: '2071-09-02' });
        if (!pilot.enabled) {
          assert.ok(!JSON.stringify(demand).includes('PRIVATE-STAGING-'));
          const row = demand.data.find((item: any) => item.sku === sku); assert.ok(row);
          assert.equal(demand.source, 'firestore'); assert.equal(row.stockSource, 'firestore');
          assert.equal(row.stockLevel, 0); assert.equal(row.totalQuantitySold, 6); assert.equal(row.orderCount, 2);
          assert.ok(!['total', 'valor', 'contato', 'notaFiscal'].some(key => Object.hasOwn(row, key)));
        }
      }
      if (role === 'Vendedor') {
        await deniedTool('listar_lotes_producao');
        if (pilot.enabled) await call('resumir_vendas', { from: '2026-09-01', to: '2026-09-12' });
      }
      if (pilot.enabled && role === 'Administrador') await call('listar_insumos', { limit: 1 });
    }
    await setRole('Administrador');
    if (pilot.enabled) {
      lastToolName = undefined;
      progress('postgres-real-copy-all-read-tools-and-pagination');
      const period = { from: '2026-09-01', to: '2026-09-12' };
      const orders = await paged('listar_pedidos', { ...period, limit: 1 });
      assert.ok(Array.isArray(orders.data) && orders.data.length > 0);
      const orderId = String(orders.data[0].id);
      const order = await call('consultar_pedido', { id: orderId, limit: 1 });
      if (order.nextCursor) await call('consultar_pedido', { id: orderId, limit: 1, cursor: order.nextCursor });
      await call('resumir_vendas', period);
      const stocks = await paged('consultar_estoque_produtos', { limit: 1 });
      assert.ok(Array.isArray(stocks.data) && stocks.data.length > 0);
      await call('consultar_estoque_produtos', { sku: stockSkuFromProofResult(stocks.data[0]), limit: 1 });
      const supply = await firstRowFromPagedRead(async (cursor, pageSize) => {
        const page = await call('listar_insumos', { limit: pageSize, ...(cursor ? { cursor } : {}) });
        return { data: page.data as Array<Record<string, unknown>>, nextCursor: page.nextCursor };
      }, 10, 10);
      assert.ok(typeof supply.id === 'string' && supply.id.length >= 1 && supply.id.length <= 200
        && !supply.id.includes('/') && !['.', '..'].includes(supply.id));
      await paged('listar_movimentacoes_insumo', { supplyId: supply.id, ...period, limit: 1 });
      await paged('consultar_demanda_producao', { ...period, limit: 1 });
      const productionOrders = await paged('listar_pedidos_para_producao', { limit: 1 });
      assert.ok(Array.isArray(productionOrders.data) && productionOrders.data.length > 0);
      const productionOrderId = String(productionOrders.data[0].id);
      const productionOrder = await call('listar_pedidos_para_producao', { orderId: productionOrderId, limit: 1 });
      if (productionOrder.nextCursor) await call('listar_pedidos_para_producao', { orderId: productionOrderId, limit: 1, cursor: productionOrder.nextCursor });
      await paged('listar_colunas_producao', { limit: 1 });
      const lots = await paged('listar_lotes_producao', { limit: 1 });
      assert.ok(Array.isArray(lots.data) && lots.data.length > 0);
      const lotId = String(lots.data[0].id);
      const lot = await call('consultar_lote_producao', { lotId, limit: 1 });
      if (lot.nextCursor) await call('consultar_lote_producao', { lotId, limit: 1, cursor: lot.nextCursor });
      assert.ok(copyMetadata);
    }
    await setActive(false); assert.equal((await mcpStatus(issued.access_token)).status, 401); await setActive(true);
    lastToolName = undefined;
    await mcpClient.close(); mcpClient = undefined;
    const audit = await scoped('mcpAuditLogs');
    assert.ok(audit.length >= 11 && audit.some(doc => doc.data().result === 'error'));
    for (const doc of audit) { assert.equal(doc.data().clientId, clientId); own(doc.ref.path); }
    const auditText = JSON.stringify(audit.map(doc => doc.data()));
    assert.ok(!auditText.includes('PRIVATE-STAGING-') && ![...secrets].some(secret => auditText.includes(secret)));
    evidence.mcp = { officialSdk: true, realHttps: true,
      ...(!pilot.enabled ? { salesTotal: 300, revenueChangePercent: 100, zeroStock: true } : {
        source: 'postgres', copy: copyMetadata, realBusinessPayloadRecorded: false,
        allApplicableReadToolsAndPagination: true, inactiveUserRejected: true,
        httpMeasurements: summarizeToolHttpSamples(toolHttpSamples),
      }), restrictedProductionProjection: true, directForbiddenToolCallsRejected: true, currentRoleEnforced: true,
      auditRedaction: true, auditCount: audit.length, roles, hostedClaude: false };

    progress('https-refresh-revoke-401-and-reconnect');
    const refreshResult = await refresh(issued.refresh_token); assert.equal(refreshResult.response.status, 200);
    const refreshed = tokens(refreshResult.data);
    const refreshJwt = await verifyStagingProofJwt(refreshed.access_token, jwks, { sub, clientId });
    assert.equal((await mcpStatus(refreshed.access_token)).status, 405);
    const repeat = await begin();
    const automatic = await app('/api/mcp-auth/session', 'POST', { authorization_id: repeat.id });
    assert.equal(automatic.response.status, 409); assert.equal(automatic.data.code, 'RECONSENT_REQUIRED');
    assert.ok(!JSON.stringify(automatic.data).includes('redirectUrl'));
    const connections = await app('/api/mcp-auth/connections'); assert.equal(connections.response.status, 200);
    assert.equal(connections.data.connections.length, 1);
    const connectionId = connections.data.connections[0].id;
    assert.equal(connectionId, sha(JSON.stringify([sub, clientId]))); own(`mcpConnections/${connectionId}`);
    assert.equal((await app('/api/mcp-auth/connections', 'DELETE', { connection_id: connectionId })).response.status, 200);
    async function assertRevoked() {
      for (const token of [issued.access_token, refreshed.access_token]) assert.equal((await mcpStatus(token)).status, 401);
      for (const token of [issued.refresh_token, refreshed.refresh_token]) assert.equal((await refresh(token)).response.status, 400);
    }
    await assertRevoked();
    const reconnect = await begin(); await prepare(reconnect);
    const nextTokens = await exchange(reconnect, await decide(reconnect));
    const reconnectJwt = await verifyStagingProofJwt(nextTokens.access_token, jwks, { sub, clientId });
    assert.equal((await mcpStatus(nextTokens.access_token)).status, 405);
    await assertRevoked();
    assert.equal((await app('/api/mcp-auth/connections', 'DELETE', { connection_id: connectionId })).response.status, 200);
    assert.equal((await mcpStatus(nextTokens.access_token)).status, 401);
    const denied = await begin(); await prepare(denied);
    assert.equal((await decide(denied, 'deny')).searchParams.get('error'), 'access_denied');
    evidence.lifecycle = { refreshAcceptedByHttpsMcp: true, revokedAccessHttpStatus: 401, providerRefreshRejected: true,
      reconnectAccepted: true, oldTokensRemainRejectedAfterReconnect: true, explicitDenial: true,
      independentJwt: { refresh: refreshJwt, reconnect: reconnectJwt } };
  } catch (error) {
    // Never render remote bodies, exceptions, cookies, passwords, URLs with codes, or Bearers.
    failedStage = stage;
    const scalar = (value: unknown) => typeof value === 'number' || typeof value === 'boolean' || value === null ? value : undefined;
    evidence.failure = { stage: failedStage, lastHttpStatus, ...(lastToolName ? { lastToolName } : {}),
      ...(error instanceof assert.AssertionError ? { assertion: { operator: error.operator,
        expected: scalar(error.expected), actual: scalar(error.actual) } } : {}) };
    process.exitCode = 1;
  } finally {
    cleaning = true; progress('cleanup-owned-synthetic-records');
    async function attempt(label: string, action: () => Promise<void>) {
      try { await action(); } catch { cleanupIssues.add(label); }
    }
    if (mcpClient) await attempt('sdk-close', () => mcpClient!.close());
    // Mark the owned identity inactive first, closing access before provider/local cleanup.
    await attempt('disable-owned-user', async () => {
      const ref = db.collection('users').doc(userId), snap = await ref.get();
      if (snap.data()?.stagingProofRunId === runId) {
        userCreated = true; own(ref.path);
        await ref.update({ active: false }, { lastUpdateTime: snap.updateTime! });
      }
    });
    // A DCR response can be lost after creation. Match the exact random client name AND callback.
    if (registrationAttempted) await attempt('recover-and-delete-owned-oauth-client', async () => {
      let finished = false;
      for (let page = 1; page <= 10; page++) {
        const result = await admin.auth.admin.oauth.listClients({ page, perPage: 100 });
        assert.equal(result.error, null);
        for (const candidate of result.data.clients) if (candidate.client_name === clientName
          && candidate.redirect_uris.length === 1 && candidate.redirect_uris[0] === callback) {
          assert.match(candidate.client_id, uuid); ownedClientIds.add(candidate.client_id); own(`supabase/oauthClients/${candidate.client_id}`);
        }
        if (result.data.clients.length < 100) { finished = true; break; }
      }
      assert.ok(finished, 'OAuth client recovery bound exceeded');
      for (const id of ownedClientIds) {
        const current = await admin.auth.admin.oauth.getClient(id);
        if (current.error?.status === 404) { pendingOwned.delete(`supabase/oauthClients/${id}`); continue; }
        assert.equal(current.error, null); assert.equal(current.data.client_name, clientName);
        assert.deepEqual(current.data.redirect_uris, [callback]);
        assert.equal((await admin.auth.admin.oauth.deleteClient(id)).error, null);
        const gone = await admin.auth.admin.oauth.getClient(id); assert.equal(gone.error?.status, 404);
        pendingOwned.delete(`supabase/oauthClients/${id}`);
      }
    });
    if (userCreated) {
      await attempt('owned-provider-identity-and-binding', async () => {
        const ref = db.collection('mcpIdentityBindings').doc(sha(userId)), binding = await ref.get();
        if (!binding.exists) return;
        assert.equal(binding.data()?.userId, userId); const sub = binding.data()?.sub as string; assert.match(sub, uuid);
        own(ref.path);
        const provider = await admin.auth.admin.getUserById(sub);
        if (provider.error?.status !== 404) {
          assert.equal(provider.error, null); assert.equal(provider.data.user?.id, sub);
          assert.equal(provider.data.user?.app_metadata.brsteel_user_id, userId); assert.equal(provider.data.user?.email, email);
          own(`supabase/users/${sub}`);
          assert.equal((await admin.auth.admin.deleteUser(sub)).error, null);
          assert.equal((await admin.auth.admin.getUserById(sub)).error?.status, 404);
        }
        pendingOwned.delete(`supabase/users/${sub}`);
        const reverseRef = db.collection('mcpIdentities').doc(sub), reverse = await reverseRef.get();
        if (reverse.exists) {
          assert.equal(reverse.data()?.userId, userId); own(reverseRef.path);
          await reverseRef.delete({ lastUpdateTime: reverse.updateTime! });
          assert.ok(!(await reverseRef.get()).exists);
        }
        pendingOwned.delete(reverseRef.path);
        await ref.delete({ lastUpdateTime: binding.updateTime! }); assert.ok(!(await ref.get()).exists); pendingOwned.delete(ref.path);
      });
      for (const collection of ['mcpAuthorizationIntents', 'mcpConnections', 'mcpAuditLogs']) await attempt(`owned-${collection}`, async () => {
        for (const doc of await scoped(collection)) {
          const data = doc.data(); assert.equal(data.userId, userId);
          if (collection === 'mcpAuthorizationIntents') {
            assert.ok(intentIds.has(doc.id)); assert.ok(ownedClientIds.has(data.authorization?.client?.id));
          } else assert.ok(ownedClientIds.has(data.clientId));
          own(doc.ref.path); await doc.ref.delete({ lastUpdateTime: doc.updateTime! });
          assert.ok(!(await doc.ref.get()).exists); pendingOwned.delete(doc.ref.path);
        }
        assert.equal((await scoped(collection)).length, 0);
      });
      await attempt('owned-rate-limits', async () => {
        assert.ok(rateMinutes.size <= 20, 'Rate cleanup minute bound exceeded');
        for (const id of ownedClientIds) for (const minute of rateMinutes) for (const bucket of ['read', 'protocol']) {
          const ref = db.collection('mcpRateLimits').doc(sha(JSON.stringify([userId, id, bucket, minute]))), snap = await ref.get();
          if (!snap.exists) continue;
          own(ref.path); await ref.delete({ lastUpdateTime: snap.updateTime! });
          assert.ok(!(await ref.get()).exists); pendingOwned.delete(ref.path);
        }
      });
    }
    for (const [path, record] of [...ownedDocs].reverse()) await attempt('owned-fixture', async () => {
      const ref = db.doc(path), snap = await ref.get();
      if (!snap.exists) { pendingOwned.delete(path); return; }
      // Includes a create() that reached Firestore but whose acknowledgement was lost.
      if (snap.data()?.stagingProofRunId !== runId) { assert.ok(!record.confirmed, 'Owned fixture changed ownership'); return; }
      own(path); await ref.delete({ lastUpdateTime: snap.updateTime! });
      assert.ok(!(await ref.get()).exists); pendingOwned.delete(path);
    });
    await attempt('firestore-terminate', () => db.terminate());
    const complete = cleanupIssues.size === 0 && pendingOwned.size === 0 && !ambiguousRequest;
    evidence.cleanup = { complete, ambiguousHttpRequest: ambiguousRequest, issues: [...cleanupIssues],
      ...(pilot.enabled ? { remainingOwnedCount: pendingOwned.size } : { remainingOwnedIds: [...pendingOwned].sort(),
        ...(!complete && registrationAttempted ? { oauthClientRecoveryName: clientName } : {}) }) };
    evidence.elapsedSeconds = Math.round((Date.now() - startedAt) / 1000);
    evidence.proof = !failedStage && complete ? 'passed' : 'failed';
    if (!complete) process.exitCode = 1;
    console.log(JSON.stringify(evidence, null, 2));
  }
}

main().catch(() => {
  // Configuration/runtime failures outside the mutation block cannot leak an env or SDK exception.
  console.error(JSON.stringify({ proof: 'refused-before-verification', hostedClaude: false }));
  process.exitCode = 1;
});
