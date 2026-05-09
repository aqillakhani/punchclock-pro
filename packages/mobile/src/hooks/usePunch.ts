import { useCallback } from 'react';
import { performPunch } from '@/services/punch.service';
import { usePunchStore } from '@/store/punch.store';
import { useAuthStore } from '@/store/auth.store';
import { apiRequest } from '@/services/http-client';

export function usePunch() {
  const { isOpen, loading, lastResult, setLoading, recordPunch, setOpen } = usePunchStore();

  const refresh = useCallback(async () => {
    try {
      const data = await apiRequest<{ entry: { id: string; punchInAt: string } | null }>(
        '/api/v1/time-tracking/current',
        { token: useAuthStore.getState().token },
      );
      setOpen(!!data.entry);
    } catch {
      // Silent — we might be offline.
    }
  }, [setOpen]);

  const clockIn = useCallback(async () => {
    setLoading(true);
    try {
      const result = await performPunch('punch_in', useAuthStore.getState().token);
      recordPunch({
        clientGeneratedId: result.clientGeneratedId,
        timestamp: result.timestamp,
        type: result.type,
      });
    } finally {
      setLoading(false);
    }
  }, [recordPunch, setLoading]);

  const clockOut = useCallback(async () => {
    setLoading(true);
    try {
      const result = await performPunch('punch_out', useAuthStore.getState().token);
      recordPunch({
        clientGeneratedId: result.clientGeneratedId,
        timestamp: result.timestamp,
        type: result.type,
      });
    } finally {
      setLoading(false);
    }
  }, [recordPunch, setLoading]);

  return { isOpen, loading, lastResult, clockIn, clockOut, refresh };
}
