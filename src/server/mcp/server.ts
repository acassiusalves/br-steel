import 'server-only';
import { randomUUID } from 'node:crypto';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { getMcpConfig, MAX_BODY_BYTES, MAX_OUTPUT_BYTES, type McpConfig } from './config';
import { authenticateMcp, type McpPrincipal } from './auth';
import { McpHttpError } from './errors';
import { createMcpServer } from './registry';
import { consumeRateLimit } from './rate-limit';
import { auditRead } from './audit';
import { readTools } from './read-tools';
function headers(request: Request, config?: McpConfig) {
  const output = new Headers({ 'cache-control': 'no-store', vary: 'Origin', 'x-content-type-options': 'nosniff' });
  const origin = request.headers.get('origin');
  if (origin && config?.allowedOrigins.has(origin)) output.set('access-control-allow-origin', origin);
  output.set('access-control-allow-methods', 'GET, POST, OPTIONS');
  output.set('access-control-allow-headers', 'Authorization, Content-Type, Accept, MCP-Protocol-Version, MCP-Session-Id');
  output.set('access-control-expose-headers', 'WWW-Authenticate, Retry-After, MCP-Protocol-Version, X-Request-Id');
  return output;
}
function httpError(request: Request, error: unknown, config?: McpConfig) {
  const known = error instanceof McpHttpError ? error : new McpHttpError('UNAVAILABLE', 'Conector temporariamente indisponível.', 503);
  const output = headers(request, config);
  if (known.status === 401 && config) output.set('www-authenticate', `Bearer resource_metadata="${config.metadataUrl}", error="invalid_token"`);
  if (known.retryAfter) output.set('retry-after', String(known.retryAfter));
  return Response.json({ error: known.code, message: known.message }, { status: known.status, headers: output });
}
export function protectedResourceMetadata(request: Request): Response {
  let config: McpConfig | undefined;
  try {
    config = getMcpConfig();
    const output = headers(request, config); output.set('access-control-allow-origin', '*');
    return Response.json({ resource: config.resource, resource_name: 'BR Steel', authorization_servers: [config.issuer],
      bearer_methods_supported: ['header'], scopes_supported: ['openid', 'email', 'profile', 'offline_access'] }, { headers: output });
  } catch (error) { return httpError(request, error, config); }
}
async function readBody(request: Request): Promise<unknown> {
  const length = request.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_BODY_BYTES)) throw new McpHttpError('BODY_LIMIT', 'Corpo excede o limite de 64 KiB.', 413);
  if (!request.body) return undefined;
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BODY_BYTES) { await reader.cancel(); throw new McpHttpError('BODY_LIMIT', 'Corpo excede o limite de 64 KiB.', 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new McpHttpError('INVALID_JSON', 'JSON inválido.', 400); }
}
export async function handleMcp(request: Request): Promise<Response> {
  const requestId = randomUUID(); const started = Date.now();
  let config: McpConfig | undefined; let principal: McpPrincipal | undefined;
  let call: { name: string; arguments: unknown } | undefined; let outcome: 'success' | 'error' | 'denied' = 'error';
  try {
    config = getMcpConfig();
    const origin = request.headers.get('origin');
    if (origin && !config.allowedOrigins.has(origin)) throw new McpHttpError('ORIGIN_FORBIDDEN', 'Origem não permitida.', 403);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: headers(request, config) });
    const parsedBody = request.method === 'POST' ? await readBody(request) : undefined;
    principal = await authenticateMcp(request);
    const outputHeaders = headers(request, config); outputHeaders.set('x-request-id', requestId);
    if (request.method !== 'POST') { outputHeaders.set('allow', 'POST, OPTIONS'); return new Response(null, { status: 405, headers: outputHeaders }); }
    if (parsedBody && !Array.isArray(parsedBody) && typeof parsedBody === 'object' && 'method' in parsedBody && parsedBody.method === 'tools/call') {
      const params = 'params' in parsedBody && parsedBody.params && typeof parsedBody.params === 'object' ? parsedBody.params : {};
      const name = 'name' in params && typeof params.name === 'string' ? params.name : '';
      call = { name: readTools.some(t => t.name === name) ? name : 'unknown', arguments: 'arguments' in params ? params.arguments : {} };
    }
    await consumeRateLimit(principal, call ? 'read' : 'protocol');
    const server = createMcpServer(principal.context);
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    try {
      await server.connect(transport);
      const response = await transport.handleRequest(request, { parsedBody });
      const body = response.body ? await response.text() : null;
      if (body && Buffer.byteLength(body) > MAX_OUTPUT_BYTES) throw new McpHttpError('OUTPUT_LIMIT', 'Resposta excede o limite de tamanho.', 413);
      if (body && response.ok) {
        const rpc = JSON.parse(body); outcome = rpc.error || rpc.result?.isError ? 'error' : 'success';
      }
      for (const [key, value] of outputHeaders) response.headers.set(key, value);
      return new Response(body, { status: response.status, headers: response.headers });
    } finally { await server.close(); }
  } catch (error) {
    if (error instanceof McpHttpError && [401, 403, 429].includes(error.status)) outcome = 'denied';
    const response = httpError(request, error, config); response.headers.set('x-request-id', requestId); return response;
  } finally {
    if (principal && call) await auditRead(principal, { requestId, tool: call.name, arguments: call.arguments, result: outcome, durationMs: Date.now() - started });
  }
}
