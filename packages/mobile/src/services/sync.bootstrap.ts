import type { Database } from '@nozbe/watermelondb';
import type { QueueItem } from '../db/types';
import { WatermelonDBSyncQueueRepo } from '../db/repos/sync-queue.watermelon';
import { initSyncService, type ServerPoster, type ServerResult, type SyncService } from './sync.service';
import { apiRequest } from './http-client';

const PATHS: Record<QueueItem['operationType'], string> = {
  create_punch_in: '/api/v1/time-tracking/punch-in',
  create_punch_out: '/api/v1/time-tracking/punch-out',
  create_break_start: '/api/v1/time-tracking/breaks',
  create_break_end: '/api/v1/time-tracking/breaks',
};

const CONFLICT_CODES = new Set(['CONFLICT', 'TIMESTAMP_COLLISION', 'GEOFENCE_BLOCKED']);

/**
 * Adapter from the queue item shape to the API contract. The poster
 * never throws — it converts every outcome to a `ServerResult` so
 * the sync service can decide retry policy from the discriminator.
 */
export function makePoster(getToken: () => string | null): ServerPoster {
  return async (item): Promise<ServerResult> => {
    const path = PATHS[item.operationType];
    try {
      const res = await apiRequest<{ entry?: { id: string }; break?: { id: string } }>(path, {
        method: 'POST',
        token: getToken(),
        timeoutMs: 4000,
        body: item.payload,
      });
      const serverId = res?.entry?.id ?? res?.break?.id ?? '';
      return { ok: true, serverId };
    } catch (err) {
      const code = (err as Error & { code?: string }).code;
      if (code && CONFLICT_CODES.has(code)) {
        return { ok: false, kind: 'conflict', reason: code };
      }
      return { ok: false, kind: 'transient', error: (err as Error).message };
    }
  };
}

/**
 * Builds the WatermelonDB-backed repo and installs it as the global
 * sync service. Call once at app boot, after `initDatabase()`.
 */
export function bootstrapSync(database: Database, getToken: () => string | null): SyncService {
  const repo = new WatermelonDBSyncQueueRepo(database);
  return initSyncService({
    repo,
    poster: makePoster(getToken),
    now: () => Date.now(),
  });
}
