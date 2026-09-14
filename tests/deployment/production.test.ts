import { expect, it } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateMcpProduction } from '../../scripts/lib/mcp-production-config';
const key = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const config = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8'));
const credential = { type: 'service_account', project_id: 'marketflow-9h4tg', client_email: 'mcp@marketflow-9h4tg.iam.gserviceaccount.com', private_key: key };
const fixture = (): Record<string, string> => ({
 BRSTEEL_DEPLOYMENT_ENV: 'production', VERCEL_PROJECT_ID: 'prj_nKDQAAfkgJ7DePQsIZy5gMELWuWj',
 APP_ORIGIN: 'https://br-steel.vercel.app', MCP_PUBLIC_URL: 'https://br-steel.vercel.app/api/mcp',
 SUPABASE_URL: 'https://mlumbvxpaqfzpdjnvzxc.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fixture', SUPABASE_SECRET_KEY: 'sb_secret_fixture',
 MCP_ENABLED: 'false', MCP_OAUTH_ENABLED: 'false', MCP_WRITES_ENABLED: 'false', MCP_USER_ACCESS_MODE: 'authenticated',
 AUTH_SESSION_SECRET: 'session-secret-fixture-32-characters', CRON_SECRET: 'cron-secret-fixture-at-least-32-characters',
 NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'marketflow-9h4tg', NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: 'marketflow-9h4tg.firebaseapp.com',
 NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: 'marketflow-9h4tg.firebasestorage.app', NEXT_PUBLIC_FIREBASE_API_KEY: 'public-fixture',
 NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: '679366570902', NEXT_PUBLIC_FIREBASE_APP_ID: '1:679366570902:web:fixture',
 FIREBASE_SERVICE_ACCOUNT_KEY: JSON.stringify(credential),
});
it('accepts preparation and enabled read-only while preserving production crons', () => {
 for (const flags of [{}, { MCP_ENABLED: 'true', MCP_OAUTH_ENABLED: 'true' }]) {
  const result = validateMcpProduction({ ...fixture(), ...flags }, config);
  expect(result.errors).toEqual([]); expect(result.summary).toMatchObject({ writes: false });
  expect(JSON.stringify(result)).not.toContain('sb_secret'); expect(JSON.stringify(result)).not.toContain('PRIVATE KEY');
 }
});
it('accepts raw JSON forms supported by Firebase Admin initialization', () => {
 const raw = JSON.stringify(credential);
 for (const value of [raw, `  ${raw}  `, `"${raw}"`, raw.replaceAll('\\n', '\n')]) {
  expect(validateMcpProduction({ ...fixture(), FIREBASE_SERVICE_ACCOUNT_KEY: value }, config).errors).toEqual([]);
 }
});
it('rejects cross-project targets, flag typos, leaked keys, weak secrets, emulators and alternate credentials', () => {
 for (const patch of [
  { VERCEL_PROJECT_ID: 'prj_staging' }, { APP_ORIGIN: 'https://br-steel-mcp-staging.vercel.app' }, { MCP_PUBLIC_URL: 'https://other.test/api/mcp' },
  { SUPABASE_URL: 'https://other.supabase.co' }, { NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'brsteel-mcp-staging' }, { FIREBASE_PROJECT_ID: 'other' },
  { NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: 'other.firebaseapp.com' }, { NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: 'other.appspot.com' },
  { NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: '123' }, { MCP_ENABLED: 'TRUE' }, { MCP_ENABLED: 'true', MCP_OAUTH_ENABLED: 'false' },
  { MCP_WRITES_ENABLED: 'true' }, { MCP_USER_ACCESS_MODE: '' }, { AUTH_SESSION_SECRET: 'short' }, { CRON_SECRET: '' },
  { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8188' }, { FIREBASE_AUTH_EMULATOR_HOST: 'localhost:9099' }, { GOOGLE_APPLICATION_CREDENTIALS: '/tmp/key.json' },
  { NEXT_PUBLIC_SUPABASE_SECRET_KEY: 'sb_secret_leak' }, { NEXT_PUBLIC_ACCIDENTAL: 'sb_secret_fixture' },
  { FIREBASE_SERVICE_ACCOUNT_KEY: JSON.stringify({ ...credential, project_id: 'other' }) },
  { FIREBASE_SERVICE_ACCOUNT_KEY: JSON.stringify({ ...credential, token_uri: 'https://evil.test' }) },
  { MCP_ALLOWED_ORIGINS: 'https://claude.ai/path' },
 ]) expect(validateMcpProduction({ ...fixture(), ...patch }, config).errors.length, JSON.stringify(Object.keys(patch))).toBeGreaterThan(0);
 expect(validateMcpProduction(fixture(), { crons: [] }).errors.length).toBeGreaterThan(0);
});

it('runs the actual offline CLI without loading local env files or printing secrets', () => {
 const cwd = mkdtempSync(join(tmpdir(), 'brsteel-production-cli-'));
 const run = (env: Record<string, string>) => spawnSync(process.execPath, ['--import', createRequire(import.meta.url).resolve('tsx'), fileURLToPath(new URL('../../scripts/mcp-production-check.ts', import.meta.url))], { cwd, env: { ...env, NODE_ENV: 'test' }, encoding: 'utf8', timeout: 10000 });
 try {
  writeFileSync(join(cwd, 'vercel.json'), JSON.stringify(config));
  const good = run(fixture()); expect(good.status).toBe(0); expect(good.stdout).toContain('valid');
  const bad = run({ ...fixture(), AUTH_SESSION_SECRET: 'short-private-value' });
  expect(bad.status).toBe(1); expect(bad.stderr).not.toContain('short-private-value');
  writeFileSync(join(cwd, 'vercel.json'), '{broken');
  expect(run(fixture()).stderr).toContain('invalid vercel.json');
 } finally { rmSync(cwd, { recursive: true, force: true }); }
});

it('declares no explicit __name__ in a Firestore index', () => {
 // O Firestore anexa __name__ implicitamente, com a direção do último campo explícito. Declará-lo
 // faz a comparação do CLI nunca casar com o que o servidor reporta: todo `firebase deploy
 // --only firestore:indexes` tenta recriar o índice, recebe 409 "index already exists" e aborta
 // antes de criar os índices que de fato faltam. Já aconteceu em produção com salesOrders.
 const declared = JSON.parse(readFileSync(new URL('../../firestore.indexes.json', import.meta.url), 'utf8'));
 const offenders = (declared.indexes as { collectionGroup: string; fields: { fieldPath: string }[] }[])
  .filter(index => index.fields.some(field => field.fieldPath === '__name__'))
  .map(index => index.collectionGroup);
 expect(offenders).toEqual([]);
});
