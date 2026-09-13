import 'server-only';
import { adminDb } from '@/lib/firebase-admin';

/**
 * How the core currently accepts work.
 *
 * `open` is normal operation. `draining` refuses new mutations while the ones already in flight
 * finish. `blocked` is the maintenance window of the source cutover: nothing new is accepted and the
 * webhook queue accumulates instead of being processed.
 *
 * Read at runtime from a shared record rather than from a build-time variable **on purpose**: an older
 * deployment still reachable on Vercel would carry the old value and keep writing. Only a shared record
 * reaches every instance.
 *
 * Today only the webhook drain consults this. The cutover delivery adds `requireCoreWritesEnabled()`
 * here and wires it into the write operations; the document and its values are already the ones that
 * plan specifies, so that change extends this file rather than replacing it.
 */
export type CoreWriteMode = 'open' | 'draining' | 'blocked';

const MODES: readonly CoreWriteMode[] = ['open', 'draining', 'blocked'];
const modeRef = () => adminDb.collection('appConfig').doc('coreWriteMode');

/** Absent or unrecognised means `open`: maintenance has to be switched on deliberately. */
export async function readCoreWriteMode(): Promise<CoreWriteMode> {
  const stored = String((await modeRef().get()).data()?.mode ?? 'open');
  return MODES.includes(stored as CoreWriteMode) ? stored as CoreWriteMode : 'open';
}
