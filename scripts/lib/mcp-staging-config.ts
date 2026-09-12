import { createPrivateKey } from 'node:crypto';
type Environment = Record<string, string | undefined>;
type DeploymentConfig = { crons?: unknown[]; buildCommand?: string };
const productionVercel = 'prj_nKDQAAfkgJ7DePQsIZy5gMELWuWj';
const existingFirebase = new Set(['marketflow-9h4tg', 'marketflow-flmb6']);
const otherSupabase = new Set(['ewooyjtdryvhoxalvjja', 'yekfxhtvhzriesqcfogz']);
function httpsRoot(raw: string | undefined) {
 try { const url = new URL(raw ?? ''); return url.protocol === 'https:' && url.pathname === '/' && !url.username && !url.password && !url.search && !url.hash && !['localhost','127.0.0.1'].includes(url.hostname) ? url.origin : null; } catch { return null; }
}
/** Offline preflight; never contacts cloud services or returns credential values. */
export function validateMcpStaging(env: Environment, config: DeploymentConfig) {
 const errors: string[] = [];
 const require = (ok: unknown, message: string) => { if (!ok) errors.push(message); };
 require(env.BRSTEEL_DEPLOYMENT_ENV === 'staging', 'BRSTEEL_DEPLOYMENT_ENV deve ser staging.');
 const project = env.BRSTEEL_STAGING_VERCEL_PROJECT_ID;
 require(project?.startsWith('prj_') && project !== productionVercel && project === env.VERCEL_PROJECT_ID, 'Vercel precisa apontar o projeto exclusivo de homologação.');
 const origin = httpsRoot(env.APP_ORIGIN);
 require(origin && origin === env.APP_ORIGIN && origin === env.BRSTEEL_STAGING_ORIGIN && !['https://br-steel.vercel.app','https://br-steel-acassius-alves-projects.vercel.app','https://br-steel-git-main-acassius-alves-projects.vercel.app'].includes(origin), 'Configure uma origem HTTPS exclusiva de homologação.');
 require(origin && env.MCP_PUBLIC_URL === `${origin}/api/mcp`, 'MCP_PUBLIC_URL deve corresponder à origem de homologação.');
 require(env.MCP_ENABLED === 'true' && env.MCP_OAUTH_ENABLED === 'true' && env.MCP_WRITES_ENABLED === 'false', 'Homologação exige MCP/OAuth habilitados e escrita desabilitada.');
 require((env.MCP_USER_ACCESS_MODE ?? 'allowlist') === 'allowlist', 'Homologação exige MCP_USER_ACCESS_MODE allowlist.');
 require(env.MCP_ALLOWED_USER_IDS?.split(',').some(id => id.trim()), 'Defina os IDs dos usuários sintéticos do piloto.');
 for (const allowed of (env.MCP_ALLOWED_ORIGINS ?? '').split(',').map(v => v.trim()).filter(Boolean)) require(httpsRoot(allowed) === allowed, 'MCP_ALLOWED_ORIGINS aceita apenas origens HTTPS exatas.');
 require(env.AUTH_SESSION_SECRET && env.AUTH_SESSION_SECRET.length >= 32, 'Configure AUTH_SESSION_SECRET exclusivo com pelo menos 32 caracteres.');
 const supabaseRef = env.BRSTEEL_STAGING_SUPABASE_PROJECT_REF;
 require(supabaseRef && /^[a-z0-9]{20}$/.test(supabaseRef) && !otherSupabase.has(supabaseRef)
  && httpsRoot(env.SUPABASE_URL) === `https://${supabaseRef}.supabase.co`, 'Configure o projeto Supabase dedicado e sua URL correspondente.');
 require(env.SUPABASE_PUBLISHABLE_KEY?.startsWith('sb_publishable_') && env.SUPABASE_SECRET_KEY?.startsWith('sb_secret_'), 'Configure as chaves pública e secreta do Supabase dedicado.');
 const firebase = env.BRSTEEL_STAGING_FIREBASE_PROJECT_ID;
 require(firebase && /^brsteel-mcp-staging(?:-[a-z0-9-]+)?$/.test(firebase) && firebase.length <= 30 && !existingFirebase.has(firebase)
  && firebase === env.NEXT_PUBLIC_FIREBASE_PROJECT_ID, 'Firebase precisa apontar o projeto exclusivo brsteel-mcp-staging.');
 for (const name of ['FIREBASE_PROJECT_ID','GCLOUD_PROJECT','GOOGLE_CLOUD_PROJECT']) require(!env[name] || env[name] === firebase, `${name} não pode apontar outro projeto.`);
 require(env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN === `${firebase}.firebaseapp.com`, 'Auth domain Firebase precisa pertencer à homologação.');
 const buckets = [`${firebase}.firebasestorage.app`, `${firebase}.appspot.com`];
 require(buckets.includes(env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? ''), 'Storage bucket Firebase precisa pertencer à homologação.');
 require(!env.FIREBASE_STORAGE_BUCKET || buckets.includes(env.FIREBASE_STORAGE_BUCKET), 'FIREBASE_STORAGE_BUCKET não pode apontar outro projeto.');
 require(env.NEXT_PUBLIC_FIREBASE_API_KEY && env.NEXT_PUBLIC_FIREBASE_API_KEY !== 'AIzaSyC_mnz6n_XQ7f4fdbGCaS3zwT26wKTumaI', 'Configure a API key pública do Firebase dedicado.');
 require(env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID && /^\d+$/.test(env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID)
  && env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID !== '679366570902'
  && env.NEXT_PUBLIC_FIREBASE_APP_ID?.startsWith(`1:${env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID}:web:`), 'Configure app ID e sender ID do Firebase dedicado.');
 try {
  const credential = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_KEY ?? '');
  require(credential.type === 'service_account' && credential.project_id === firebase
   && typeof credential.client_email === 'string' && credential.client_email.endsWith(`@${firebase}.iam.gserviceaccount.com`)
   && createPrivateKey(credential.private_key).asymmetricKeyType === 'rsa', 'A conta de serviço precisa pertencer ao Firebase de homologação.');
 } catch { errors.push('FIREBASE_SERVICE_ACCOUNT_KEY precisa conter uma conta de serviço válida para homologação.'); }
 for (const [key, value] of Object.entries(env)) {
  if (!value) continue;
  if (/^(BLING_|ML_|MERCADO_?LIVRE_)/.test(key)) errors.push(`Remova a integração externa ${key} da homologação.`);
  if (/^NEXT_PUBLIC_.*(SECRET|PRIVATE_KEY|ACCESS_TOKEN|REFRESH_TOKEN|SERVICE_ACCOUNT|SERVICE_ROLE)/.test(key)) errors.push(`A variável ${key} não pode ser pública.`);
 }
 require(!env.FIRESTORE_EMULATOR_HOST && !env.NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST, 'O deploy público não pode usar emuladores locais.');
 require(Array.isArray(config.crons) && config.crons.length === 0, 'Use a configuração de homologação sem crons.');
 require(config.buildCommand === 'npm run verify:mcp-staging && npm run build', 'O build precisa executar a verificação de homologação.');
 return { errors, summary: errors.length ? null : { vercelProject: project, firebaseProject: firebase, supabaseProject: supabaseRef, resource: env.MCP_PUBLIC_URL, writes: false } };
}
