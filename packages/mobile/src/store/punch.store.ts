import { create } from 'zustand';

export interface LocalPunch {
  clientGeneratedId: string;
  timestamp: string;
  type: 'punch_in' | 'punch_out';
  location?: { latitude: number; longitude: number; accuracy?: number };
}

interface PunchState {
  isOpen: boolean;
  loading: boolean;
  lastResult: LocalPunch | null;
  setOpen: (open: boolean) => void;
  setLoading: (loading: boolean) => void;
  recordPunch: (punch: LocalPunch) => void;
}

export const usePunchStore = create<PunchState>((set) => ({
  isOpen: false,
  loading: false,
  lastResult: null,
  setOpen: (isOpen) => set({ isOpen }),
  setLoading: (loading) => set({ loading }),
  recordPunch: (lastResult) => set({ lastResult, isOpen: lastResult.type === 'punch_in' }),
}));
