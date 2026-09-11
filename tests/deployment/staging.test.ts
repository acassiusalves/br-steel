import { describe, expect, it } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { spawnSync } from 'node:child_process';
const key = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
import { validateMcpStaging } from '../../scripts/lib/mcp-staging-config';
const fixture = () => ({
 BRSTEEL_DEPLOYMENT_ENV: 'staging', VERCEL_PROJECT_ID: 'prj_test_staging', BRSTEEL_STAGING_VERCEL_PROJECT_ID: 'prj_test_staging',
 BRSTEEL_STAGING_ORIGIN: 'https://brsteel-mcp-staging.example.test', APP_ORIGIN: 'https://brsteel-mcp-staging.example.test', MCP_PUBLIC_URL: 'https://brsteel-mcp-staging.example.test/api/mcp',
 MCP_ENABLED: 'true', MCP_OAUTH_ENABLED: 'true', MCP_WRITES_ENABLED: 'false', MCP_ALLOWED_USER_IDS: 'test-admin',
 BRSTEEL_STAGING_SUPABASE_PROJECT_REF: 'stagingfixtureproj01', SUPABASE_URL: 'https://stagingfixtureproj01.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_local_fixture', SUPABASE_SECRET_KEY: 'sb_secret_local_fixture',
 AUTH_SESSION_SECRET: 'local-fixture-secret-at-least-32-characters',
 BRSTEEL_STAGING_FIREBASE_PROJECT_ID: 'brsteel-mcp-staging-fixture', NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'brsteel-mcp-staging-fixture',
 NEXT_PUBLIC_FIREBASE_API_KEY: 'test-public-key', NEXT_PUBLIC_FIREBASE_APP_ID: '1:12345:web:fixture', NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: 'brsteel-mcp-staging-fixture.firebaseapp.com',
 NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: 'brsteel-mcp-staging-fixture.firebasestorage.app', NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: '12345',
 FIREBASE_SERVICE_ACCOUNT_KEY: JSON.stringify({ type: 'service_account', project_id: 'brsteel-mcp-staging-fixture', client_email: 'mcp@brsteel-mcp-staging-fixture.iam.gserviceaccount.com', private_key: key }),
});
const config = { crons: [], buildCommand: 'npm run verify:mcp-staging && npm run build' };
describe('isolated MCP staging configuration', () => {
 it('accepts a complete dedicated staging environment without returning secret values', () => {
  const result = validateMcpStaging(fixture(), config);
  expect(result.errors).toEqual([]); expect(result.summary).toMatchObject({ firebaseProject: 'brsteel-mcp-staging-fixture', resource: fixture().MCP_PUBLIC_URL });
  expect(JSON.stringify(result)).not.toContain('sb_secret'); expect(JSON.stringify(result)).not.toContain('PRIVATE KEY');
 });
 it('executes the actual staging CLI and rejects incomplete configuration with a sanitized message', () => {
  const run = (env: Record<string, string>) => spawnSync(process.execPath, ['--import', 'tsx', 'scripts/mcp-staging-check.ts'], { encoding: 'utf8', env: { NODE_ENV: 'test', ...env }, cwd: process.cwd() });
  const accepted = run(fixture()); expect(accepted.status).toBe(0);
  expect(JSON.parse(accepted.stdout).stagingConfiguration).toBe('valid');
  const rejected = run({}); expect(rejected.status).toBe(1);
  expect(rejected.stderr).toContain('Configuração de homologação recusada:');
  expect(rejected.stderr).not.toContain('PRIVATE KEY');
 });
 it('fails closed for production links, partial projects and cross-project service accounts', () => {
  for (const patch of [
   { VERCEL_PROJECT_ID: 'prj_nKDQAAfkgJ7DePQsIZy5gMELWuWj' }, { NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'marketflow-9h4tg' },
   { NEXT_PUBLIC_FIREBASE_PROJECT_ID: '' }, { NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: 'marketflow-9h4tg.firebaseapp.com' },
   { FIREBASE_SERVICE_ACCOUNT_KEY: JSON.stringify({ project_id: 'marketflow-9h4tg' }) },
   { FIREBASE_PROJECT_ID: 'marketflow-9h4tg' }, { GCLOUD_PROJECT: 'marketflow-9h4tg' }, { GOOGLE_CLOUD_PROJECT: 'marketflow-9h4tg' },
   { NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: 'marketflow-9h4tg.firebasestorage.app' },
   { APP_ORIGIN: 'https://br-steel.vercel.app', MCP_PUBLIC_URL: 'https://br-steel.vercel.app/api/mcp' },
  ]) expect(validateMcpStaging({ ...fixture(), ...patch }, config).errors.length).toBeGreaterThan(0);
 });
 it('rejects inherited integrations, emulator flags, crons and unsafe OAuth configuration', () => {
  for (const patch of [
   { BLING_CLIENT_SECRET: 'do-not-print-this-secret' }, { ML_CLIENT_SECRET: 'private' }, { MERCADOLIVRE_ACCESS_TOKEN: 'private' },
   { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8188' }, { NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST: '127.0.0.1:8188' },
   { MCP_ALLOWED_ORIGINS: '*' }, { NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY: 'do-not-print-this-secret' }, { MCP_WRITES_ENABLED: 'true' }, { MCP_ALLOWED_USER_IDS: '' }, { BRSTEEL_DEPLOYMENT_ENV: '' },
   { APP_ORIGIN: 'http://localhost:9003', MCP_PUBLIC_URL: 'http://localhost:9003/api/mcp' },
   { SUPABASE_URL: 'http://127.0.0.1:55321' }, { SUPABASE_URL: 'https://ewooyjtdryvhoxalvjja.supabase.co' },
   { MCP_PUBLIC_URL: 'https://different.example.test/api/mcp' }, { AUTH_SESSION_SECRET: 'short' },
  ]) {
   const result = validateMcpStaging({ ...fixture(), ...patch }, config); expect(result.errors.length).toBeGreaterThan(0);
   expect(JSON.stringify(result)).not.toContain('do-not-print-this-secret');
  }
  expect(validateMcpStaging(fixture(), { ...config, crons: [{ path: '/api/cron/ml-health', schedule: '* * * * *' }] }).errors.length).toBeGreaterThan(0);
 });
});
