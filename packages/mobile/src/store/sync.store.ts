import { create } from 'zustand';

export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'offline' | 'error';

interface SyncState {
  status: SyncStatus;
  lastSyncedAt: number | null;
  queueSize: number;
  setStatus: (status: SyncStatus) => void;
  setLastSyncedAt: (ts: number) => void;
  setQueueSize: (n: number) => void;
}

export const useSyncStore = create<SyncState>((set) => ({
  status: 'idle',
  lastSyncedAt: null,
  queueSize: 0,
  setStatus: (status) => set({ status }),
  setLastSyncedAt: (ts) => set({ lastSyncedAt: ts }),
  setQueueSize: (n) => set({ queueSize: n }),
}));
