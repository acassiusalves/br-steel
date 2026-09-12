import 'server-only';
import type { AccessContext } from '@/server/access/types';
import { HOSTED_SOURCE, hostedPoolConfig } from '@/server/migration/operational-hosted';
import { MAX_COPY_AGE_MS, type PilotSnapshotPolicy } from '@/server/persistence/pilot-snapshot';

export function getPostgresPilotConfig(context: AccessContext, env: Record<string,string | undefined> = process.env, now = Date.now()) {
  if (context.actor.source !== 'mcp' || !env.MCP_PG_PILOT_ENABLED || env.MCP_PG_PILOT_ENABLED === 'false') return null;
  const users = (env.MCP_PG_PILOT_USER_IDS ?? '').split(',').map(value=>value.trim()).filter(Boolean);
  if (!users.includes(context.actor.userId)) return null;
  const snapshotHash = env.MCP_PG_PILOT_SNAPSHOT_HASH ?? '', expiresAt = Date.parse(env.MCP_PG_PILOT_EXPIRES_AT ?? '');
  const databaseUrl = env.MCP_PG_PILOT_DATABASE_URL ?? '', ca = env.MCP_PG_PILOT_CA ?? '';
  if (env.MCP_PG_PILOT_ENABLED !== 'true' || !/^[a-f0-9]{64}$/.test(snapshotHash) || !ca.trim()
    || !Number.isFinite(expiresAt) || expiresAt <= now || expiresAt > now + MAX_COPY_AGE_MS) throw new Error('Invalid operational pilot configuration');
  hostedPoolConfig(databaseUrl,'reader',ca);
  const policy: PilotSnapshotPolicy = { sourceProject:HOSTED_SOURCE,snapshotHash,expiresAt };
  return { policy,databaseUrl,ca };
}
