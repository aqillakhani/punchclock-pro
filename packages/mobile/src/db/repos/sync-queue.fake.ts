import type { NewQueueItem, QueueItem, QueueStatus } from '../types';
import { backoffFor, type SyncQueueRepo } from './sync-queue.repo';

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `q_${idCounter}`;
}

/**
 * Stand-in for the WatermelonDB-backed repo. Holds rows in a plain
 * Map so multiple sync.service instances can share state via the
 * same repo (modeling restart durability) without needing native
 * SQLite.
 */
export class InMemorySyncQueueRepo implements SyncQueueRepo {
  private rows = new Map<string, QueueItem>();

  async enqueue(item: NewQueueItem, now: number): Promise<QueueItem> {
    for (const existing of this.rows.values()) {
      if (existing.clientGeneratedId === item.clientGeneratedId) {
        return existing;
      }
    }
    const row: QueueItem = {
      ...item,
      id: nextId(),
      status: 'pending',
      retryCount: 0,
      lastRetryAt: null,
      queuedAt: now,
      serverId: null,
      errorMessage: null,
      conflictReason: null,
    };
    this.rows.set(row.id, row);
    return row;
  }

  async listEligible(now: number): Promise<QueueItem[]> {
    const out: QueueItem[] = [];
    for (const row of this.rows.values()) {
      if (row.status !== 'pending') continue;
      if (row.lastRetryAt === null) {
        out.push(row);
        continue;
      }
      if (now - row.lastRetryAt >= backoffFor(row.retryCount)) {
        out.push(row);
      }
    }
    out.sort((a, b) => b.priority - a.priority || a.queuedAt - b.queuedAt);
    return out;
  }

  async listByStatus(status: QueueStatus): Promise<QueueItem[]> {
    return Array.from(this.rows.values()).filter((r) => r.status === status);
  }

  async size(): Promise<number> {
    return this.rows.size;
  }

  async countByStatus(status: QueueStatus): Promise<number> {
    let n = 0;
    for (const r of this.rows.values()) if (r.status === status) n += 1;
    return n;
  }

  async markSynced(id: string, serverId: string): Promise<void> {
    const row = this.rows.get(id);
    if (!row) return;
    this.rows.set(id, { ...row, status: 'synced', serverId, errorMessage: null });
  }

  async markConflict(id: string, reason: string): Promise<void> {
    const row = this.rows.get(id);
    if (!row) return;
    this.rows.set(id, { ...row, status: 'conflict', conflictReason: reason });
  }

  async markFailed(id: string, error: string): Promise<void> {
    const row = this.rows.get(id);
    if (!row) return;
    this.rows.set(id, { ...row, status: 'failed', errorMessage: error });
  }

  async recordRetry(id: string, error: string, now: number): Promise<QueueItem> {
    const row = this.rows.get(id);
    if (!row) throw new Error(`No queue item ${id}`);
    const updated: QueueItem = {
      ...row,
      retryCount: row.retryCount + 1,
      lastRetryAt: now,
      errorMessage: error,
    };
    this.rows.set(id, updated);
    return updated;
  }

  async clear(): Promise<void> {
    this.rows.clear();
  }
}
