import type { NewQueueItem, QueueItem, QueueStatus } from '../types';

/**
 * Persistence boundary for the offline sync queue.
 *
 * The repo is intentionally narrow so the same logic in
 * `sync.service` can run against either the real WatermelonDB-backed
 * implementation on device or the in-memory fake used in tests.
 *
 * All timestamps are unix milliseconds.
 */
export interface SyncQueueRepo {
  /**
   * Enqueue a new item. If an item with the same clientGeneratedId
   * already exists the existing item is returned unchanged
   * (idempotency: the same logical operation must not be queued
   * twice). Returns the persisted item.
   */
  enqueue(item: NewQueueItem, now: number): Promise<QueueItem>;

  /**
   * Items with status='pending' that are eligible to flush at `now`.
   * An item is eligible if it has never been retried, or if
   * (now - lastRetryAt) >= backoffFor(retryCount).
   */
  listEligible(now: number): Promise<QueueItem[]>;

  listByStatus(status: QueueStatus): Promise<QueueItem[]>;

  size(): Promise<number>;
  countByStatus(status: QueueStatus): Promise<number>;

  markSynced(id: string, serverId: string): Promise<void>;
  markConflict(id: string, reason: string): Promise<void>;
  markFailed(id: string, error: string): Promise<void>;

  /**
   * Record a transient failure: bumps retryCount, sets lastRetryAt,
   * stores errorMessage. Caller decides whether to flip the row to
   * 'failed' once retryCount exceeds the policy.
   *
   * Only call this when the server actually answered. A request that
   * never reached the server must not consume an item's retry budget
   * — see `ServerUnreachable` in sync.service.
   */
  recordRetry(id: string, error: string, now: number): Promise<QueueItem>;

  /**
   * Return a 'failed' item to the queue with a clean retry budget, so
   * a punch that exhausted its retries during an outage can still be
   * delivered instead of being lost. Resolves to the requeued item, or
   * null when no such row exists.
   */
  requeue(id: string): Promise<QueueItem | null>;

  clear(): Promise<void>;
}

/**
 * Backoff before a server-rejected item is offered to the poster again.
 *
 * Read this against the auto-sync tick (60s): a backoff shorter than the
 * tick gates nothing. The original 1s/2s/4s curve meant three consecutive
 * ticks exhausted the whole retry budget in about three minutes, so a
 * brief outage discarded the punch. These steps are minutes, so the
 * budget spans hours of genuine server-side failure.
 */
const RETRY_BACKOFF_MS = [
  60_000, // 1 min
  5 * 60_000,
  15 * 60_000,
  30 * 60_000,
  60 * 60_000, // held at 1 hour for every further attempt
];

/**
 * Backoff in milliseconds for an item that has already failed
 * `retryCount` times. retryCount=0 means never retried — eligible
 * immediately.
 */
export function backoffFor(retryCount: number): number {
  if (retryCount <= 0) return 0;
  const step = Math.min(retryCount, RETRY_BACKOFF_MS.length) - 1;
  return RETRY_BACKOFF_MS[step]!;
}
