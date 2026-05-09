export type QueueStatus = 'pending' | 'synced' | 'failed' | 'conflict';

export type OperationType = 'create_punch_in' | 'create_punch_out' | 'create_break_start' | 'create_break_end';

export interface NewQueueItem {
  clientGeneratedId: string;
  operationType: OperationType;
  priority: number;
  payload: unknown;
}

export interface QueueItem extends NewQueueItem {
  id: string;
  status: QueueStatus;
  retryCount: number;
  lastRetryAt: number | null;
  queuedAt: number;
  serverId: string | null;
  errorMessage: string | null;
  conflictReason: string | null;
}
