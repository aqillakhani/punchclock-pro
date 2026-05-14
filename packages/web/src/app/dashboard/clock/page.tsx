'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

interface CurrentEntry {
  entry: { id: string; punchInAt: string } | null;
}

interface PunchWarning {
  code: string;
  message: string;
}

interface PunchInResult {
  timeEntry: { id: string };
  warnings?: PunchWarning[];
}

interface PunchOutResult {
  timeEntry: { id: string };
  warnings?: PunchWarning[];
}

export default function ClockPage() {
  const qc = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<PunchWarning[]>([]);

  const current = useQuery<CurrentEntry>({
    queryKey: ['time-tracking', 'current'],
    queryFn: () => apiClient.get('/api/v1/time-tracking/current'),
  });

  const punchIn = useMutation({
    mutationFn: async () => {
      const location = await getLocation();
      return apiClient.post<PunchInResult>('/api/v1/time-tracking/punch-in', {
        clientGeneratedId: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        location,
        deviceInfo: { deviceId: 'web', platform: 'web' },
      });
    },
    onSuccess: (data) => {
      setMessage('Clocked in successfully');
      setWarnings(data?.warnings ?? []);
      qc.invalidateQueries({ queryKey: ['time-tracking', 'current'] });
    },
    onError: (e: Error) => {
      setMessage(e.message);
      setWarnings([]);
    },
  });

  const punchOut = useMutation({
    mutationFn: async () => {
      const location = await getLocation();
      return apiClient.post<PunchOutResult>('/api/v1/time-tracking/punch-out', {
        clientGeneratedId: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        location,
      });
    },
    onSuccess: (data) => {
      setMessage('Clocked out successfully');
      setWarnings(data?.warnings ?? []);
      qc.invalidateQueries({ queryKey: ['time-tracking', 'current'] });
    },
    onError: (e: Error) => {
      setMessage(e.message);
      setWarnings([]);
    },
  });

  const isOpen = !!current.data?.entry;

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="mb-8 text-2xl font-semibold text-slate-900">Clock in / out</h1>
      <div className="rounded-lg border border-slate-200 bg-white p-8 text-center shadow-sm">
        <div className="mb-4 text-sm uppercase text-slate-500">Current status</div>
        <div className="mb-8 text-2xl font-bold">
          {current.isLoading ? '…' : isOpen ? 'Clocked In' : 'Clocked Out'}
        </div>
        <button
          type="button"
          onClick={() => (isOpen ? punchOut.mutate() : punchIn.mutate())}
          disabled={punchIn.isPending || punchOut.isPending}
          className="w-full rounded-md bg-brand-600 px-6 py-4 text-xl font-semibold text-white shadow hover:bg-brand-700 disabled:opacity-60"
        >
          {isOpen ? 'Punch Out' : 'Punch In'}
        </button>
        {message && <p className="mt-4 text-sm text-slate-600">{message}</p>}
        {warnings.length > 0 && (
          <div className="mt-4 space-y-2 text-left">
            {warnings.map((w, i) => (
              <div
                key={`${w.code}-${i}`}
                className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
              >
                <div className="font-medium">Heads up</div>
                <div>{w.message}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

async function getLocation(): Promise<
  { latitude: number; longitude: number; accuracy: number } | undefined
> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return undefined;
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        }),
      () => resolve(undefined),
      { enableHighAccuracy: true, timeout: 5_000, maximumAge: 0 },
    );
  });
}
