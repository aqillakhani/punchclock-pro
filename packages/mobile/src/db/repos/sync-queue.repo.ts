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
   */
  recordRetry(id: string, error: string, now: number): Promise<QueueItem>;

  clear(): Promise<void>;
}

/**
 * Backoff in milliseconds for an item that has already failed
 * `retryCount` times. retryCount=0 means never retried — eligible
 * immediately.
 */
export function backoffFor(retryCount: number): number {
  if (retryCount <= 0) return 0;
  return 2 ** (retryCount - 1) * 1000;
}
