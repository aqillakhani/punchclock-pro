import type { NewQueueItem, QueueItem } from '../db/types';
import type { SyncQueueRepo } from '../db/repos/sync-queue.repo';
import { useSyncStore } from '../store/sync.store';

export interface ServerAck {
  ok: true;
  serverId: string;
}

export interface ServerConflict {
  ok: false;
  kind: 'conflict';
  reason: string;
}

export interface ServerTransient {
  ok: false;
  kind: 'transient';
  error: string;
}

export type ServerResult = ServerAck | ServerConflict | ServerTransient;

/**
 * Posts a queued operation to the server. Implementations must
 * return a `ServerResult` rather than throwing — the sync service
 * inspects the discriminator to decide whether to mark synced,
 * mark conflict, or schedule a retry.
 */
export type ServerPoster = (item: QueueItem) => Promise<ServerResult>;

export interface SyncDeps {
  repo: SyncQueueRepo;
  poster: ServerPoster;
  now: () => number;
  /** Maximum retry attempts before an item is moved to status='failed'. */
  maxRetries?: number;
}

export interface FlushSummary {
  synced: number;
  conflicts: number;
  retried: number;
  failed: number;
  skipped: number;
}

export interface SyncService {
  enqueue(item: NewQueueItem): Promise<QueueItem>;
  flush(): Promise<FlushSummary>;
  queueSize(): Promise<number>;
}

const DEFAULT_MAX_RETRIES = 3;

export function createSyncService(deps: SyncDeps): SyncService {
  const { repo, poster, now, maxRetries = DEFAULT_MAX_RETRIES } = deps;

  return {
    async enqueue(item) {
      return repo.enqueue(item, now());
    },

    async queueSize() {
      return repo.countByStatus('pending');
    },

    async flush() {
      const summary: FlushSummary = {
        synced: 0,
        conflicts: 0,
        retried: 0,
        failed: 0,
        skipped: 0,
      };
      const t = now();
      const eligible = await repo.listEligible(t);
      const totalPending = await repo.countByStatus('pending');
      summary.skipped = totalPending - eligible.length;

      for (const item of eligible) {
        const result = await poster(item);
        if (result.ok) {
          await repo.markSynced(item.id, result.serverId);
          summary.synced += 1;
          continue;
        }
        if (result.kind === 'conflict') {
          await repo.markConflict(item.id, result.reason);
          summary.conflicts += 1;
          continue;
        }
        const updated = await repo.recordRetry(item.id, result.error, t);
        if (updated.retryCount >= maxRetries) {
          await repo.markFailed(item.id, result.error);
          summary.failed += 1;
        } else {
          summary.retried += 1;
        }
      }

      return summary;
    },
  };
}

// ---- Module-level singleton for runtime use ----
//
// Tests construct services explicitly via `createSyncService` so they
// never touch this state. Mobile code (punch.service, _layout) reads
// from `getSyncService()` after `initSyncService()` has been called
// at app boot.

let _service: SyncService | null = null;

export function initSyncService(deps: SyncDeps): SyncService {
  _service = createSyncService(deps);
  return _service;
}

export function resetSyncService(): void {
  _service = null;
}

export function getSyncService(): SyncService {
  if (!_service) {
    throw new Error('SyncService not initialized — call initSyncService() at app boot.');
  }
  return _service;
}

export function tryGetSyncService(): SyncService | null {
  return _service;
}

/**
 * Periodic flush loop. Drains the queue every `intervalMs` and
 * mirrors the result into the Zustand sync store so the UI badge
 * stays current. Returns a stopper.
 */
export function startAutoSync(intervalMs = 60_000): () => void {
  let cancelled = false;

  const tick = async () => {
    if (cancelled) return;
    const service = _service;
    if (!service) return;
    const store = useSyncStore.getState();
    store.setStatus('syncing');
    try {
      const summary = await service.flush();
      const remaining = await service.queueSize();
      store.setQueueSize(remaining);
      store.setLastSyncedAt(Date.now());
      const errored = summary.failed > 0 || summary.conflicts > 0;
      store.setStatus(remaining > 0 ? 'syncing' : errored ? 'error' : 'synced');
    } catch {
      store.setStatus('error');
    }
  };

  const handle = setInterval(tick, intervalMs);
  // Kick off an immediate tick so the queue starts draining without
  // waiting a full interval.
  tick().catch(() => undefined);

  return () => {
    cancelled = true;
    clearInterval(handle);
  };
}
