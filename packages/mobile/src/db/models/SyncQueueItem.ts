import { Model } from '@nozbe/watermelondb';
import type { OperationType, QueueStatus } from '../types';

interface SyncQueueRaw {
  event_id: string;
  operation_type: OperationType;
  payload_json: string;
  priority: number;
  retry_count: number;
  last_retry_at: number | null;
  queued_at: number;
  status: QueueStatus;
  error_message: string | null;
  server_id: string | null;
  conflict_reason: string | null;
}

/**
 * WatermelonDB model wrapper for the `sync_queue` table.
 *
 * We deliberately access `_raw` directly instead of using
 * `@nozbe/watermelondb/decorators`. Avoiding decorators keeps the
 * TypeScript configuration aligned with the rest of the monorepo
 * (no experimentalDecorators) — the boundary between this thin
 * wrapper and `SyncQueueRepoWatermelon` is the only place where the
 * raw column names leak through, and the repo translates them to
 * the camelCase `QueueItem` shape used by the rest of the app.
 */
export class SyncQueueItemModel extends Model {
  static table = 'sync_queue';

  private get raw(): SyncQueueRaw {
    return this._raw as unknown as SyncQueueRaw;
  }

  get clientGeneratedId(): string {
    return this.raw.event_id;
  }

  get operationType(): OperationType {
    return this.raw.operation_type;
  }

  get payloadJson(): string {
    return this.raw.payload_json;
  }

  get priority(): number {
    return this.raw.priority;
  }

  get retryCount(): number {
    return this.raw.retry_count;
  }

  get lastRetryAt(): number | null {
    return this.raw.last_retry_at;
  }

  get queuedAt(): number {
    return this.raw.queued_at;
  }

  get status(): QueueStatus {
    return this.raw.status;
  }

  get errorMessage(): string | null {
    return this.raw.error_message;
  }

  get serverId(): string | null {
    return this.raw.server_id;
  }

  get conflictReason(): string | null {
    return this.raw.conflict_reason;
  }
}
