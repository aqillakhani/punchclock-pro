import type { Database } from '@nozbe/watermelondb';
import { Q } from '@nozbe/watermelondb';
import type { NewQueueItem, QueueItem, QueueStatus } from '../types';
import { SyncQueueItemModel } from '../models/SyncQueueItem';
import { backoffFor, type SyncQueueRepo } from './sync-queue.repo';

const TABLE = 'sync_queue';

interface MutableRaw {
  event_id: string;
  operation_type: string;
  payload_json: string;
  priority: number;
  retry_count: number;
  last_retry_at: number | null;
  queued_at: number;
  status: string;
  error_message: string | null;
  server_id: string | null;
  conflict_reason: string | null;
}

function modelToItem(m: SyncQueueItemModel): QueueItem {
  return {
    id: m.id,
    clientGeneratedId: m.clientGeneratedId,
    operationType: m.operationType,
    payload: JSON.parse(m.payloadJson),
    priority: m.priority,
    retryCount: m.retryCount,
    lastRetryAt: m.lastRetryAt,
    queuedAt: m.queuedAt,
    status: m.status,
    errorMessage: m.errorMessage,
    serverId: m.serverId,
    conflictReason: m.conflictReason,
  };
}

/**
 * Production sync queue: persists rows to SQLite via WatermelonDB.
 *
 * Requires the native iOS/Android build (the SQLite adapter is
 * implemented natively). Tests use `InMemorySyncQueueRepo` instead;
 * this implementation is exercised by integration tests that boot
 * the app on a real device or simulator.
 */
export class WatermelonDBSyncQueueRepo implements SyncQueueRepo {
  constructor(private readonly db: Database) {}

  private collection() {
    return this.db.get<SyncQueueItemModel>(TABLE);
  }

  async enqueue(item: NewQueueItem, now: number): Promise<QueueItem> {
    const collection = this.collection();
    const existing = await collection
      .query(Q.where('event_id', item.clientGeneratedId))
      .fetch();
    if (existing.length > 0) {
      return modelToItem(existing[0]!);
    }

    let created!: SyncQueueItemModel;
    await this.db.write(async () => {
      created = await collection.create((rec) => {
        const raw = rec._raw as unknown as MutableRaw;
        raw.event_id = item.clientGeneratedId;
        raw.operation_type = item.operationType;
        raw.payload_json = JSON.stringify(item.payload);
        raw.priority = item.priority;
        raw.retry_count = 0;
        raw.last_retry_at = null;
        raw.queued_at = now;
        raw.status = 'pending';
        raw.error_message = null;
        raw.server_id = null;
        raw.conflict_reason = null;
      });
    });
    return modelToItem(created);
  }

  async listEligible(now: number): Promise<QueueItem[]> {
    const collection = this.collection();
    const pending = await collection.query(Q.where('status', 'pending')).fetch();
    const out: QueueItem[] = [];
    for (const m of pending) {
      const last = m.lastRetryAt;
      if (last === null || now - last >= backoffFor(m.retryCount)) {
        out.push(modelToItem(m));
      }
    }
    out.sort((a, b) => b.priority - a.priority || a.queuedAt - b.queuedAt);
    return out;
  }

  async listByStatus(status: QueueStatus): Promise<QueueItem[]> {
    const rows = await this.collection().query(Q.where('status', status)).fetch();
    return rows.map(modelToItem);
  }

  async size(): Promise<number> {
    return this.collection().query().fetchCount();
  }

  async countByStatus(status: QueueStatus): Promise<number> {
    return this.collection().query(Q.where('status', status)).fetchCount();
  }

  private async updateRow(
    id: string,
    mutator: (raw: MutableRaw) => void,
  ): Promise<SyncQueueItemModel> {
    const row = await this.collection().find(id);
    await this.db.write(async () => {
      await row.update((rec) => {
        const raw = rec._raw as unknown as MutableRaw;
        mutator(raw);
      });
    });
    return row;
  }

  async markSynced(id: string, serverId: string): Promise<void> {
    await this.updateRow(id, (raw) => {
      raw.status = 'synced';
      raw.server_id = serverId;
      raw.error_message = null;
    });
  }

  async markConflict(id: string, reason: string): Promise<void> {
    await this.updateRow(id, (raw) => {
      raw.status = 'conflict';
      raw.conflict_reason = reason;
    });
  }

  async markFailed(id: string, error: string): Promise<void> {
    await this.updateRow(id, (raw) => {
      raw.status = 'failed';
      raw.error_message = error;
    });
  }

  async recordRetry(id: string, error: string, now: number): Promise<QueueItem> {
    const row = await this.updateRow(id, (raw) => {
      raw.retry_count += 1;
      raw.last_retry_at = now;
      raw.error_message = error;
    });
    return modelToItem(row);
  }

  async clear(): Promise<void> {
    const all = await this.collection().query().fetch();
    await this.db.write(async () => {
      for (const row of all) {
        await row.markAsDeleted();
      }
    });
  }
}
