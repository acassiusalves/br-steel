import 'server-only';
import { adminDb } from '@/lib/firebase-admin';
import { OperationError } from './common';
import { parseCoreWriteMode, type CoreWriteMode } from './switch-values';

/**
 * How the core currently accepts work.
 *
 * `open` is normal operation. `draining` refuses new mutations while the ones already in flight
 * finish. `blocked` is the maintenance window of the source cutover and of the return. In both, webhook
 * deliveries are queued without being applied and the drain is suspended; they are applied once the
 * mode is `open` again.
 *
 * Read at runtime from a shared record rather than from a build-time variable **on purpose**: an older
 * deployment still reachable on Vercel would carry the old value and keep writing. Only a shared record
 * reaches every instance.
 *
 * Consulted by the Bling webhook, by the webhook drain and by every core write operation.
 */
export type { CoreWriteMode };

const modeRef = () => adminDb.collection('appConfig').doc('coreWriteMode');

/** Absent or unrecognised means `open`: maintenance has to be switched on deliberately. */
export async function readCoreWriteMode(): Promise<CoreWriteMode> {
  return parseCoreWriteMode((await modeRef().get()).data()?.mode);
}

// A window is opened and closed by a person, so seconds of staleness are fine; a read per mutation is
// not. The cache is per instance, which is why the value itself has to be shared.
const MAX_CACHE_MS = 5000;
let cached: { mode: CoreWriteMode; at: number } | null = null;

/** Only for tests and for the cutover script, which must not act on a value it warmed itself. */
export function resetCoreWriteModeCache() { cached = null; }

/**
 * Refuses a mutation while the core is being drained or is blocked.
 *
 * Called after authorization and before validation, so an unauthorized caller still learns it is
 * unauthorized rather than being told about a maintenance window it has no business knowing about.
 */
export async function requireCoreWritesEnabled(): Promise<void> {
  if (!cached || Date.now() - cached.at > MAX_CACHE_MS) {
    cached = { mode: await readCoreWriteMode(), at: Date.now() };
  }
  if (cached.mode === 'open') return;
  throw new OperationError('MAINTENANCE',
    'Manutenção em andamento: as alterações estão temporariamente suspensas. Tente novamente em alguns minutos.', 503);
}
