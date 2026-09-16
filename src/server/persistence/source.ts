import 'server-only';
import { Pool, type PoolConfig } from 'pg';
import { adminDb } from '@/lib/firebase-admin';
import { OperationError } from '@/server/operations/common';

/**
 * Which store the core currently reads and writes.
 *
 * Read at runtime from a shared record, never from a build-time variable: an older deployment still
 * reachable on Vercel would carry the previous value and keep using the wrong store — the same reason
 * the maintenance mode lives in a record. Absent or unrecognised means `firestore`: the source changes
 * deliberately, never by accident or by a typo in configuration.
 */
export type OperationalSource = 'firestore' | 'postgres';

const SOURCES: readonly OperationalSource[] = ['firestore', 'postgres'];
const MAX_CACHE_MS = 5000;
let cached: { source: OperationalSource; at: number } | null = null;
let pool: Pool | null = null;
// Bumped whenever the pool is discarded, so a repository built over the old one is rebuilt instead of
// answering through a connection that no longer exists.
let generation = 0;

/** Only for tests and for the cutover script, which must not act on a value it warmed itself. */
export function resetOperationalSource() {
  cached = null;
  generation++;
  const previous = pool;
  pool = null;
  if (previous) void previous.end().catch(() => undefined);
}

export async function readOperationalSource(): Promise<OperationalSource> {
  if (cached && Date.now() - cached.at <= MAX_CACHE_MS) return cached.source;
  const stored = String((await adminDb.collection('appConfig').doc('operationalSource').get()).data()?.source ?? 'firestore');
  const source = SOURCES.includes(stored as OperationalSource) ? stored as OperationalSource : 'firestore';
  cached = { source, at: Date.now() };
  return source;
}

/**
 * Recusa uma ação que só sabe operar no Firestore quando a fonte ativa é outra.
 *
 * Existe para ferramentas administrativas destrutivas que varrem uma coleção inteira: depois de um
 * corte, elas apagariam a base que não está mais em uso, e o operador veria "pronto" sem que nada do
 * que ele quis apagar tivesse saído. Recusar alto é a única resposta honesta enquanto não houver
 * equivalente na outra fonte.
 */
export async function requireFirestoreSource(action: string): Promise<void> {
  const source = await readOperationalSource();
  if (source === 'firestore') return;
  throw new OperationError('UNAVAILABLE',
    `${action} só opera sobre o Firestore, e a fonte ativa é ${source}. A ação foi recusada para não alterar a base errada.`, 503);
}

/**
 * Refuses anything but an explicit, TLS-verified connection under a dedicated role. The login name is
 * the controller's to choose when provisioning, so it is not pinned here — but `postgres` is refused:
 * the runtime must never hold the superuser.
 */
export function operationalPoolConfig(connectionString: string, ca?: string): PoolConfig {
  const url = new URL(connectionString);
  const user = decodeURIComponent(url.username);
  const loopback = ['127.0.0.1', 'localhost', '::1'].includes(url.hostname);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.search || url.hash || !user) {
    throw new OperationError('UNAVAILABLE', 'Conexão operacional inválida.', 503);
  }
  // The local database is the disposable one the integration suite creates; it carries no real data.
  if (loopback && url.pathname !== '/brsteel_ops_local') {
    throw new OperationError('UNAVAILABLE', 'Conexão local só é aceita para o banco descartável.', 503);
  }
  if (!loopback && (user === 'postgres' || user.startsWith('postgres.') || !url.password)) {
    throw new OperationError('UNAVAILABLE', 'A fonte operacional exige um papel dedicado, nunca o superusuário.', 503);
  }
  return {
    host: url.hostname, port: Number(url.port || 5432), database: url.pathname.slice(1),
    user, password: decodeURIComponent(url.password),
    ...(loopback ? {} : { ssl: { rejectUnauthorized: true, ...(ca ? { ca } : {}) } }),
    max: 4, connectionTimeoutMillis: 10000, idleTimeoutMillis: 10000, statement_timeout: 30000,
    application_name: 'brsteel-operational',
  };
}

function operationalPool(): Pool {
  if (pool) return pool;
  const connectionString = process.env.BRSTEEL_OPERATIONAL_DATABASE_URL;
  if (!connectionString) {
    // Selected but unreachable is unavailability, never a silent fall back to the other store: during
    // a cutover that would send writes to the source everyone believes has been retired.
    throw new OperationError('UNAVAILABLE', 'Fonte PostgreSQL selecionada sem conexão configurada.', 503);
  }
  pool = new Pool(operationalPoolConfig(connectionString, process.env.BRSTEEL_OPERATIONAL_CA));
  // A failed idle connection must not crash the process or log credentials.
  pool.on('error', () => {});
  return pool;
}

/**
 * Resolves the active implementation per call, not at module load. A repository bound once at import
 * would freeze the source for the lifetime of the instance, and the cutover has to take effect without
 * a redeploy. Every method of every repository contract is async, which is what makes this safe.
 */
export function selectRepository<T extends object>(firestore: T, postgres: (client: Pool) => T): T {
  type Methods = Record<string | symbol, (...input: unknown[]) => unknown>;
  let built: { value: T; generation: number } | null = null;
  return new Proxy({} as T, {
    get(_target, property) {
      return async (...args: unknown[]) => {
        const source = await readOperationalSource();
        if (source === 'firestore') return (firestore as Methods)[property](...args);
        if (!built || built.generation !== generation) {
          built = { value: postgres(operationalPool()), generation };
        }
        return (built.value as Methods)[property](...args);
      };
    },
  });
}
