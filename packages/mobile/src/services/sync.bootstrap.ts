import type { Database } from '@nozbe/watermelondb';
import type { QueueItem } from '../db/types';
import { WatermelonDBSyncQueueRepo } from '../db/repos/sync-queue.watermelon';
import {
  initSyncService,
  type ServerPoster,
  type ServerResult,
  type SyncService,
} from './sync.service';
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
      const serverId = res?.entry?.id ?? res?.break?.id;
      if (!serverId) {
        // Accepting this would mark the punch synced with no server-side
        // handle, leaving nothing to reconcile against later. Treat it as
        // a server-side failure rather than quietly losing the reference.
        return {
          ok: false,
          kind: 'transient',
          error: 'API accepted the punch without returning an id',
        };
      }
      return { ok: true, serverId };
    } catch (err) {
      const message = (err as Error).message;
      const code = (err as Error & { code?: string }).code;
      if (code) {
        // An error code only exists on a parsed API envelope, so the
        // server received the operation and rejected it deliberately.
        if (CONFLICT_CODES.has(code)) {
          return { ok: false, kind: 'conflict', reason: code };
        }
        return { ok: false, kind: 'transient', error: message };
      }
      // No code means no API response came back at all: airplane mode,
      // no signal, DNS/TLS failure, the 4s abort, or a gateway that
      // answered with something that is not our JSON envelope. The punch
      // never reached the server, so it keeps its full retry budget.
      return { ok: false, kind: 'unreachable', error: message };
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
