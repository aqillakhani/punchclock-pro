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

/**
 * The server answered, and answered with a failure — a 5xx, a bad
 * gateway body, anything that might succeed later. Consumes retry budget.
 */
export interface ServerTransient {
  ok: false;
  kind: 'transient';
  error: string;
}

/**
 * The request never reached the API at all: no network, DNS or TLS
 * failure, or a client-side timeout. Distinct from `transient` because
 * the server never saw the operation, and because the phone may sit in
 * this state for days.
 *
 * Time spent offline must cost an item nothing. Counting it as a failure
 * is what let a worker who punched out of coverage lose the punch a few
 * minutes later — the whole point of an offline-first queue is that the
 * punch survives exactly this situation.
 */
export interface ServerUnreachable {
  ok: false;
  kind: 'unreachable';
  error: string;
}

export type ServerResult = ServerAck | ServerConflict | ServerTransient | ServerUnreachable;

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
  /** Pending, but still inside its backoff window. */
  skipped: number;
  /** Eligible, but left untouched because the server was unreachable. */
  deferred: number;
}

export interface SyncService {
  enqueue(item: NewQueueItem): Promise<QueueItem>;
  flush(): Promise<FlushSummary>;
  queueSize(): Promise<number>;
  /** Items that exhausted their retry budget and need attention. */
  failedCount(): Promise<number>;
  /** Return every failed item to the queue. Resolves to how many moved. */
  retryFailed(): Promise<number>;
}

/**
 * Attempts against a *responding* server before an item is parked as
 * 'failed'. Paired with the minutes-long backoff schedule this spans
 * several hours, and parking is no longer terminal — `retryFailed()`
 * puts items back — so the cap protects the queue from a poison pill
 * without ever silently discarding a punch.
 */
const DEFAULT_MAX_RETRIES = 8;

export function createSyncService(deps: SyncDeps): SyncService {
  const { repo, poster, now, maxRetries = DEFAULT_MAX_RETRIES } = deps;

  return {
    async enqueue(item) {
      return repo.enqueue(item, now());
    },

    async queueSize() {
      return repo.countByStatus('pending');
    },

    async failedCount() {
      return repo.countByStatus('failed');
    },

    async retryFailed() {
      const failed = await repo.listByStatus('failed');
      let moved = 0;
      for (const item of failed) {
        if (await repo.requeue(item.id)) moved += 1;
      }
      return moved;
    },

    async flush() {
      const summary: FlushSummary = {
        synced: 0,
        conflicts: 0,
        retried: 0,
        failed: 0,
        skipped: 0,
        deferred: 0,
      };
      const t = now();
      const eligible = await repo.listEligible(t);
      const totalPending = await repo.countByStatus('pending');
      summary.skipped = totalPending - eligible.length;

      for (let i = 0; i < eligible.length; i += 1) {
        const item = eligible[i]!;
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
        if (result.kind === 'unreachable') {
          // The network is down, not the item. Leave this item and every
          // one behind it exactly as they are — untouched retryCount,
          // untouched lastRetryAt — and try the whole batch again next
          // tick. Stopping early also matters on a dead network: each
          // further post would just burn its full client timeout.
          summary.deferred = eligible.length - i;
          break;
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
      const failed = await service.failedCount();
      store.setQueueSize(remaining);
      store.setFailedCount(failed);
      // Only a tick that actually reached the server counts as a sync;
      // otherwise "last synced" would tick forward all through an outage.
      if (summary.deferred === 0) store.setLastSyncedAt(Date.now());

      if (summary.deferred > 0) store.setStatus('offline');
      else if (failed > 0 || summary.conflicts > 0) store.setStatus('error');
      else store.setStatus(remaining > 0 ? 'syncing' : 'synced');
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
