#!/usr/bin/env node
// Starts only the dedicated local identity provider; never uses linked/cloud commands.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
const network = 'brsteel-mcp-oauth-local';
const keyPath = 'supabase/.env.signing-keys.local';
const privateLog = 'supabase/.env.start.local';
const exclude = 'realtime,storage-api,imgproxy,mailpit,postgrest,postgres-meta,studio,edge-runtime,logflare,vector,supavisor';

function run(command, args, { allowFailure = false } = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  // CLI start/status/key generation can print secrets. Never forward their raw output.
  // Some CLI 2.114.0 legacy handlers emit an Error envelope with exit status 0.
  const reportedError = result.stdout?.split('\n').some((line) => {
    try { return JSON.parse(line)?._tag === 'Error'; } catch { return false; }
  });
  if ((result.status !== 0 || reportedError) && !allowFailure) {
    writeFileSync(privateLog, `${result.stdout ?? ''}\n${result.stderr ?? ''}`, { mode: 0o600 });
    chmodSync(privateLog, 0o600);
    throw new Error(`${command} ${args.slice(0, 2).join(' ')} failed; private diagnostics: ${privateLog}`);
  }
  return result;
}

const version = run('supabase', ['--version']).stdout.trim();
if (version !== '2.114.0') throw new Error(`Expected Supabase CLI 2.114.0; found ${version}`);
if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Node.js 22+ is required');

// CLI defaults for opaque API keys are deterministic. Give this provider its own keys.
const providerEnv = 'supabase/.env.local';
if (!existsSync(providerEnv)) {
  const values = {
    BRSTEEL_OAUTH_JWT_SECRET: randomBytes(48).toString('base64url'),
    BRSTEEL_OAUTH_PUBLISHABLE_KEY: `sb_publishable_${randomBytes(24).toString('base64url')}`,
    BRSTEEL_OAUTH_SECRET_KEY: `sb_secret_${randomBytes(24).toString('base64url')}`,
  };
  writeFileSync(providerEnv, Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n') + '\n', { mode: 0o600 });
}
chmodSync(providerEnv, 0o600);

if (!existsSync(keyPath)) {
  writeFileSync(keyPath, '[]', { mode: 0o600 });
  // With signing_keys_path configured the CLI writes the file itself.
  run('supabase', ['gen', 'signing-key', '--algorithm', 'ES256']);
}
const keys = JSON.parse(readFileSync(keyPath, 'utf8'));
if (!Array.isArray(keys) || !keys.some((key) => key.alg === 'ES256' && key.d)) {
  throw new Error('Expected a private ES256 signing key array in the ignored key file');
}
chmodSync(keyPath, 0o600);

let net = run('docker', ['network', 'inspect', network], { allowFailure: true });
if (net.status !== 0) {
  run('docker', ['network', 'create', '--driver', 'bridge', '--opt',
    'com.docker.network.bridge.host_binding_ipv4=127.0.0.1', network]);
  net = run('docker', ['network', 'inspect', network]);
}
if (JSON.parse(net.stdout)[0].Options['com.docker.network.bridge.host_binding_ipv4'] !== '127.0.0.1') {
  throw new Error('Dedicated Docker network must bind published ports to 127.0.0.1');
}

console.log('Starting dedicated local Supabase OAuth provider; credentials withheld.');
run('supabase', ['start', '--network-id', network, '--exclude', exclude]);
run('supabase', ['migration', 'up', '--local']);
const status = JSON.parse(run('supabase', ['status', '-o', 'json']).stdout);
if (status.API_URL !== 'http://127.0.0.1:55321' || !status.SECRET_KEY?.startsWith('sb_secret_')) {
  throw new Error('Unexpected local API URL or missing secret API key');
}
for (const container of ['supabase_db_brsteel-mcp-oauth', 'supabase_kong_brsteel-mcp-oauth']) {
  const detail = JSON.parse(run('docker', ['inspect', container]).stdout)[0];
  for (const bindings of Object.values(detail.NetworkSettings.Ports ?? {})) {
    for (const binding of bindings ?? []) {
      if (binding.HostIp !== '127.0.0.1') throw new Error(`${container} has a non-loopback port binding`);
    }
  }
}

const path = '.env.oauth.local';
const vars = {
  SUPABASE_URL: status.API_URL,
  SUPABASE_PUBLISHABLE_KEY: status.PUBLISHABLE_KEY,
  SUPABASE_SECRET_KEY: status.SECRET_KEY,
  APP_ORIGIN: 'http://localhost:9003',
  MCP_PUBLIC_URL: 'http://localhost:9003/api/mcp',
  MCP_OAUTH_ENABLED: 'true',
};
const preserved = existsSync(path) ? readFileSync(path, 'utf8').split('\n')
  .filter((line) => line.trim() && !Object.keys(vars).some((key) => line.startsWith(`${key}=`))) : [];
writeFileSync(path, [...preserved, ...Object.entries(vars).map(([key, value]) => `${key}=${value}`), ''].join('\n'), { mode: 0o600 });
chmodSync(path, 0o600);
console.log('Provider running at http://127.0.0.1:55321; .env.oauth.local updated privately.');
