import { createPrivateKey } from 'node:crypto';
type Environment = Record<string, string | undefined>;
export const PRODUCTION = Object.freeze({
 vercel: 'prj_nKDQAAfkgJ7DePQsIZy5gMELWuWj', firebase: 'marketflow-9h4tg', supabase: 'mlumbvxpaqfzpdjnvzxc',
 origin: 'https://br-steel.vercel.app', resource: 'https://br-steel.vercel.app/api/mcp',
});
const crons = [
 { path: '/api/cron/ml-health', schedule: '0 6 * * *' },
 { path: '/api/cron/ml-messages-drain', schedule: '* * * * *' },
 { path: '/api/cron/ml-messages-backfill', schedule: '*/5 * * * *' },
 { path: '/api/cron/bling-webhook-drain', schedule: '*/5 * * * *' },
];
// Match the raw JSON forms accepted by src/lib/firebase-admin.ts without loading the SDK or credentials.
function parseCredential(raw: string) {
 const trimmed = raw.trim();
 const unwrapped = trimmed.startsWith('"') && trimmed.endsWith('"') ? trimmed.slice(1, -1) : trimmed;
 for (const candidate of [raw, trimmed, unwrapped, ...[raw, trimmed, unwrapped].map(value => value.replace(/\r?\n/g, '\\n'))]) {
  try { return JSON.parse(candidate); } catch { /* Try the next supported representation. */ }
 }
 throw new Error('Invalid service-account JSON');
}
/** Pure offline preflight. Never reads environment files, contacts services, or returns secrets. */
export function validateMcpProduction(env: Environment, config: { crons?: unknown[] }) {
 const errors: string[] = [];
 const require = (ok: unknown, message: string) => { if (!ok) errors.push(message); };
 for (const [key, expected] of Object.entries({
  BRSTEEL_DEPLOYMENT_ENV: 'production', VERCEL_PROJECT_ID: PRODUCTION.vercel,
  APP_ORIGIN: PRODUCTION.origin, MCP_PUBLIC_URL: PRODUCTION.resource,
  SUPABASE_URL: `https://${PRODUCTION.supabase}.supabase.co`,
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: PRODUCTION.firebase,
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: `${PRODUCTION.firebase}.firebaseapp.com`,
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: '679366570902', MCP_WRITES_ENABLED: 'false',
 })) require(env[key] === expected, `Exact production value required for ${key}.`);
 for (const flag of ['MCP_ENABLED', 'MCP_OAUTH_ENABLED']) require(['true', 'false'].includes(env[flag] ?? ''), `${flag} must be true or false.`);
 require(env.MCP_ENABLED !== 'true' || env.MCP_OAUTH_ENABLED === 'true', 'Enabled MCP requires enabled OAuth.');
 require(['allowlist', 'authenticated'].includes(env.MCP_USER_ACCESS_MODE ?? 'allowlist'), 'MCP_USER_ACCESS_MODE must be allowlist or authenticated.');
 if (env.MCP_ENABLED === 'true' && (env.MCP_USER_ACCESS_MODE ?? 'allowlist') === 'allowlist') require(env.MCP_ALLOWED_USER_IDS?.split(',').some(id => id.trim()), 'Enabled allowlist mode requires user IDs.');
 for (const key of ['AUTH_SESSION_SECRET', 'CRON_SECRET']) require((env[key]?.length ?? 0) >= 32, `${key} requires at least 32 characters.`);
 require(env.SUPABASE_PUBLISHABLE_KEY?.startsWith('sb_publishable_') && env.SUPABASE_SECRET_KEY?.startsWith('sb_secret_'), 'Configure dedicated Supabase publishable and secret keys.');
 for (const key of ['FIREBASE_PROJECT_ID', 'GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT']) require(!env[key] || env[key] === PRODUCTION.firebase, `${key} cannot target another project.`);
 const buckets = [`${PRODUCTION.firebase}.firebasestorage.app`, `${PRODUCTION.firebase}.appspot.com`];
 require(buckets.includes(env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? ''), 'Production Firebase storage bucket required.');
 require(!env.FIREBASE_STORAGE_BUCKET || buckets.includes(env.FIREBASE_STORAGE_BUCKET), 'FIREBASE_STORAGE_BUCKET cannot target another project.');
 require(Boolean(env.NEXT_PUBLIC_FIREBASE_API_KEY), 'Firebase public API key required.');
 require(/^1:679366570902:web:[a-zA-Z0-9]+$/.test(env.NEXT_PUBLIC_FIREBASE_APP_ID ?? ''), 'Production Firebase web app ID required.');
 for (const origin of (env.MCP_ALLOWED_ORIGINS ?? '').split(',').map(value => value.trim()).filter(Boolean)) {
  try { const url = new URL(origin); require(url.protocol === 'https:' && url.origin === origin && !url.username && !url.password, 'MCP_ALLOWED_ORIGINS requires exact HTTPS origins.'); }
  catch { errors.push('MCP_ALLOWED_ORIGINS requires exact HTTPS origins.'); }
 }
 try {
  const credential = parseCredential(env.FIREBASE_SERVICE_ACCOUNT_KEY ?? '');
  require(credential.type === 'service_account' && credential.project_id === PRODUCTION.firebase
   && typeof credential.client_email === 'string' && credential.client_email.endsWith(`@${PRODUCTION.firebase}.iam.gserviceaccount.com`)
   && createPrivateKey(credential.private_key).asymmetricKeyType === 'rsa', 'Production Firebase RSA service account required.');
  require(!credential.universe_domain || credential.universe_domain === 'googleapis.com', 'Service account universe must be googleapis.com.');
  require(!credential.token_uri || credential.token_uri === 'https://oauth2.googleapis.com/token', 'Service account token URL must be Google OAuth.');
 } catch { errors.push('Valid production FIREBASE_SERVICE_ACCOUNT_KEY JSON required.'); }
 const secretValues = ['AUTH_SESSION_SECRET', 'CRON_SECRET', 'SUPABASE_SECRET_KEY', 'FIREBASE_SERVICE_ACCOUNT_KEY'].map(key => env[key]).filter((value): value is string => Boolean(value));
 for (const [key, value] of Object.entries(env)) {
  if (!value) continue;
  if (/EMULATOR|^(GOOGLE_APPLICATION_CREDENTIALS|FIREBASE_CONFIG)$/.test(key)) errors.push(`Remove emulator or alternate credentials ${key}.`);
  if (key.startsWith('NEXT_PUBLIC_') && (/SECRET|PRIVATE_KEY|ACCESS_TOKEN|REFRESH_TOKEN|SERVICE_ACCOUNT|SERVICE_ROLE/.test(key)
   || /sb_secret_|-----BEGIN .*PRIVATE KEY-----/.test(value) || secretValues.some(secret => value.includes(secret)))) errors.push(`Public variable ${key} exposes a secret.`);
 }
 require(Array.isArray(config.crons) && config.crons.length === crons.length && crons.every(expected => config.crons!.some(value => {
  if (!value || typeof value !== 'object') return false;
  const cron = value as Record<string, unknown>;
  return cron.path === expected.path && cron.schedule === expected.schedule;
 })), 'Preserve every existing production cron path and schedule.');
 return { errors, summary: errors.length ? null : { vercelProject: PRODUCTION.vercel, firebaseProject: PRODUCTION.firebase,
  supabaseProject: PRODUCTION.supabase, resource: PRODUCTION.resource, phase: env.MCP_ENABLED === 'true' ? 'read-only' : 'preparation', writes: false } };
}
