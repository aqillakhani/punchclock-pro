import { create } from 'zustand';

export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'offline' | 'error';

interface SyncState {
  status: SyncStatus;
  lastSyncedAt: number | null;
  queueSize: number;
  /**
   * Punches that exhausted their retry budget against a responding
   * server. They are still on the device and still recoverable — the
   * count exists so the UI can say so instead of losing them quietly.
   */
  failedCount: number;
  setStatus: (status: SyncStatus) => void;
  setLastSyncedAt: (ts: number) => void;
  setQueueSize: (n: number) => void;
  setFailedCount: (n: number) => void;
}

export const useSyncStore = create<SyncState>((set) => ({
  status: 'idle',
  lastSyncedAt: null,
  queueSize: 0,
  failedCount: 0,
  setStatus: (status) => set({ status }),
  setLastSyncedAt: (ts) => set({ lastSyncedAt: ts }),
  setQueueSize: (n) => set({ queueSize: n }),
  setFailedCount: (n) => set({ failedCount: n }),
}));
