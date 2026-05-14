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

interface OrgVerificationInfo {
  punch_verification_methods: ('selfie' | 'pin' | 'ip' | 'device')[];
  feature_cash_drawer: boolean;
}

interface PinStatus {
  hasPin: boolean;
}

interface MeInfo {
  id: string;
  worksite: 'onshore' | 'offshore';
}

export default function ClockPage() {
  const qc = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<PunchWarning[]>([]);
  const [pin, setPin] = useState('');
  const [drawerCount, setDrawerCount] = useState('');

  const current = useQuery<CurrentEntry>({
    queryKey: ['time-tracking', 'current'],
    queryFn: () => apiClient.get('/api/v1/time-tracking/current'),
  });

  const me = useQuery<MeInfo>({
    queryKey: ['auth', 'me'],
    queryFn: () => apiClient.get('/auth/me'),
    staleTime: 5 * 60 * 1000,
  });

  const orgVerify = useQuery<OrgVerificationInfo>({
    queryKey: ['admin', 'organization'],
    queryFn: () => apiClient.get('/api/v1/admin/organization'),
    staleTime: 60_000,
  });
  const pinEnabled = (orgVerify.data?.punch_verification_methods ?? []).includes('pin');
  const cashDrawerEnabled =
    !!orgVerify.data?.feature_cash_drawer && me.data?.worksite === 'onshore';

  const pinStatus = useQuery<PinStatus>({
    queryKey: ['me', 'pin-status'],
    queryFn: () => apiClient.get('/api/v1/me/pin-status'),
    enabled: pinEnabled,
  });

  async function recordCashDrawer(timeEntryId: string, countType: 'start' | 'end') {
    if (!cashDrawerEnabled || !drawerCount.trim()) return;
    const dollars = Number(drawerCount.replace(/[^0-9.]/g, ''));
    if (!Number.isFinite(dollars) || dollars < 0) return;
    try {
      await apiClient.post('/api/v1/me/cash-drawer', {
        timeEntryId,
        countType,
        countedCents: Math.round(dollars * 100),
      });
    } catch {
      // Soft-fail — drawer count is auxiliary; don't block the punch UX.
    }
  }

  const punchIn = useMutation({
    mutationFn: async () => {
      const location = await getLocation();
      return apiClient.post<PunchInResult>('/api/v1/time-tracking/punch-in', {
        clientGeneratedId: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        location,
        deviceInfo: { deviceId: 'web', platform: 'web' },
        ...(pinEnabled && pin ? { pin } : {}),
      });
    },
    onSuccess: async (data) => {
      setMessage('Clocked in successfully');
      setWarnings(data?.warnings ?? []);
      setPin('');
      if (data?.timeEntry?.id) await recordCashDrawer(data.timeEntry.id, 'start');
      setDrawerCount('');
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
    onSuccess: async (data) => {
      setMessage('Clocked out successfully');
      setWarnings(data?.warnings ?? []);
      if (data?.timeEntry?.id) await recordCashDrawer(data.timeEntry.id, 'end');
      setDrawerCount('');
      qc.invalidateQueries({ queryKey: ['time-tracking', 'current'] });
    },
    onError: (e: Error) => {
      setMessage(e.message);
      setWarnings([]);
    },
  });

  const isOpen = !!current.data?.entry;
  const needsToSetPin = pinEnabled && pinStatus.data && !pinStatus.data.hasPin;

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="mb-8 text-2xl font-semibold text-slate-900">Clock in / out</h1>

      {needsToSetPin && (
        <SetPinCard
          onSet={() => {
            qc.invalidateQueries({ queryKey: ['me', 'pin-status'] });
          }}
        />
      )}

      <div className="rounded-lg border border-slate-200 bg-white p-8 text-center shadow-sm">
        <div className="mb-4 text-sm uppercase text-slate-500">Current status</div>
        <div className="mb-8 text-2xl font-bold">
          {current.isLoading ? '…' : isOpen ? 'Clocked In' : 'Clocked Out'}
        </div>

        {pinEnabled && !needsToSetPin && !isOpen && (
          <div className="mb-4">
            <label className="block text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              PIN
            </label>
            <input
              type="password"
              inputMode="numeric"
              autoComplete="off"
              maxLength={8}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-center text-lg tracking-widest focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
              placeholder="••••"
            />
          </div>
        )}

        {cashDrawerEnabled && (
          <div className="mb-4">
            <label className="block text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              {isOpen ? 'Ending drawer count' : 'Starting drawer count'} ($)
            </label>
            <input
              type="number"
              step="0.01"
              min={0}
              inputMode="decimal"
              value={drawerCount}
              onChange={(e) => setDrawerCount(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-center text-lg tabular-nums focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
              placeholder="0.00"
            />
            <p className="mt-1 text-left text-xs text-slate-500">
              Optional. Variance over $5 will be flagged for the manager on the Timesheets review.
            </p>
          </div>
        )}

        <button
          type="button"
          onClick={() => (isOpen ? punchOut.mutate() : punchIn.mutate())}
          disabled={punchIn.isPending || punchOut.isPending || (needsToSetPin && !isOpen)}
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

function SetPinCard({ onSet }: { onSet: () => void }) {
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: (body: { pin: string; confirmPin: string }) =>
      apiClient.post('/api/v1/me/pin', body),
    onSuccess: () => {
      setPin('');
      setConfirmPin('');
      setErr(null);
      onSet();
    },
    onError: (e: Error) => setErr(e.message),
  });

  return (
    <div className="mb-6 rounded-lg border border-amber-300 bg-amber-50 p-5 text-sm">
      <h2 className="text-base font-semibold text-amber-900">Set a PIN to punch in</h2>
      <p className="mt-1 text-amber-800">
        Your store requires a PIN at the clock. Pick a 4–8 digit code you can remember — you&apos;ll
        enter it every time you punch.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setErr(null);
          if (pin.length < 4) {
            setErr('PIN must be at least 4 digits.');
            return;
          }
          if (pin !== confirmPin) {
            setErr('PINs do not match.');
            return;
          }
          mutation.mutate({ pin, confirmPin });
        }}
        className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2"
      >
        <div>
          <label className="block text-xs font-medium uppercase tracking-wide text-amber-800">
            New PIN
          </label>
          <input
            type="password"
            inputMode="numeric"
            autoComplete="new-password"
            maxLength={8}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            className="mt-1 w-full rounded-md border border-amber-300 px-3 py-2 text-center text-lg tracking-widest focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-200"
            placeholder="••••"
          />
        </div>
        <div>
          <label className="block text-xs font-medium uppercase tracking-wide text-amber-800">
            Confirm
          </label>
          <input
            type="password"
            inputMode="numeric"
            autoComplete="new-password"
            maxLength={8}
            value={confirmPin}
            onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ''))}
            className="mt-1 w-full rounded-md border border-amber-300 px-3 py-2 text-center text-lg tracking-widest focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-200"
            placeholder="••••"
          />
        </div>
        <div className="sm:col-span-2 flex items-center justify-between gap-3">
          <p className="text-xs text-amber-800">
            Tip: don&apos;t share your PIN. PIN sharing is the most common way buddy-punching sneaks
            past these checks.
          </p>
          <button
            type="submit"
            disabled={mutation.isPending}
            className="rounded-md bg-amber-700 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-800 disabled:opacity-60"
          >
            {mutation.isPending ? 'Saving…' : 'Save PIN'}
          </button>
        </div>
        {err && <p className="sm:col-span-2 text-sm text-rose-700">{err}</p>}
      </form>
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
