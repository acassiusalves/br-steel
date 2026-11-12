/**
 * Pure interpretation of the two shared switches that govern the operational core, kept free of
 * Firebase and pg so that tools holding their own named app (the return CLI) can read the same records
 * without importing the modules that initialize the default app.
 */

/** Which store the core currently reads and writes. */
export type OperationalSource = 'firestore' | 'postgres';

/** How the core currently accepts work. */
export type CoreWriteMode = 'open' | 'draining' | 'blocked';

const SOURCES: readonly OperationalSource[] = ['firestore', 'postgres'];
const MODES: readonly CoreWriteMode[] = ['open', 'draining', 'blocked'];

/** Absent or unrecognised means `firestore`: the source changes deliberately, never by a typo. */
export function parseOperationalSource(stored: unknown): OperationalSource {
  const value = String(stored ?? 'firestore');
  return SOURCES.includes(value as OperationalSource) ? value as OperationalSource : 'firestore';
}

/** Absent or unrecognised means `open`: maintenance has to be switched on deliberately. */
export function parseCoreWriteMode(stored: unknown): CoreWriteMode {
  const value = String(stored ?? 'open');
  return MODES.includes(value as CoreWriteMode) ? value as CoreWriteMode : 'open';
}
