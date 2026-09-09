'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PERMISSIONS, can, type Role } from '@punchclock/shared';
import { apiClient } from '@/lib/api-client';

interface Me {
  id: string;
  role: Role;
}

interface PayPeriodSummary {
  startDate: string;
  endDate: string;
  status: 'open' | 'locked';
  lockedAt: string | null;
  lockedBy: string | null;
  lockedByName: string | null;
  note: string | null;
  totalHours: number;
  workerCount: number;
  isCurrent: boolean;
}

interface LockConfirmState {
  period: PayPeriodSummary;
  note: string;
}

interface UnlockConfirmState {
  period: PayPeriodSummary;
  reason: string;
}

export default function PayPeriodsPage() {
  const qc = useQueryClient();
  const [lockConfirm, setLockConfirm] = useState<LockConfirmState | null>(null);
  const [unlockConfirm, setUnlockConfirm] = useState<UnlockConfirmState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const me = useQuery<Me>({
    queryKey: ['auth', 'me'],
    queryFn: () => apiClient.get('/auth/me'),
    staleTime: 5 * 60 * 1000,
  });

  const periods = useQuery<PayPeriodSummary[]>({
    queryKey: ['admin', 'pay-periods'],
    queryFn: () => apiClient.get('/api/v1/admin/pay-periods?count=8'),
    enabled: !!me.data && can(me.data.role, PERMISSIONS.VIEW_PAY_PERIODS),
  });

  const lockMutation = useMutation({
    mutationFn: (input: { startDate: string; note?: string }) =>
      apiClient.post('/api/v1/admin/pay-periods/lock', input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'pay-periods'] });
      setLockConfirm(null);
      setError(null);
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  const unlockMutation = useMutation({
    mutationFn: (input: { startDate: string; reason: string }) =>
      apiClient.post('/api/v1/admin/pay-periods/unlock', input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'pay-periods'] });
      setUnlockConfirm(null);
      setError(null);
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  const canLock = me.data ? can(me.data.role, PERMISSIONS.LOCK_PAY_PERIOD) : false;

  if (!me.data) {
    return <div className="p-6 text-slate-500">Loading…</div>;
  }

  if (!can(me.data.role, PERMISSIONS.VIEW_PAY_PERIODS)) {
    return <div className="p-6 text-slate-500">You don't have permission to view pay periods.</div>;
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-slate-900">Pay periods</h1>
        <p className="text-sm text-slate-600">
          View recent pay periods and lock completed ones to protect payroll data.
        </p>
      </div>

      {error && (
        <div className="mb-6 rounded-lg border border-red-300 bg-red-50 p-4">
          <p className="text-sm text-red-700">{error}</p>
          <button
            type="button"
            onClick={() => setError(null)}
            className="mt-2 text-sm font-medium text-red-600 hover:text-red-800"
          >
            Dismiss
          </button>
        </div>
      )}

      {lockConfirm && (
        <div className="mb-6 rounded-lg border border-amber-300 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-amber-900">Lock pay period?</p>
          <p className="mt-2 text-sm text-amber-800">
            Locking <strong>{formatDateRange(lockConfirm.period)}</strong> prevents any further
            changes to hours within these dates. You can unlock it later if needed.
          </p>
          <div className="mt-4">
            <label htmlFor="lock-note" className="block text-xs font-medium text-amber-900">
              Note (optional)
            </label>
            <textarea
              id="lock-note"
              value={lockConfirm.note}
              onChange={(e) => setLockConfirm({ ...lockConfirm, note: e.target.value })}
              className={`${inputClass} mt-1 text-sm`}
              rows={2}
              placeholder="e.g., Payroll processed on 2026-07-30"
            />
          </div>
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              disabled={lockMutation.isPending}
              onClick={() =>
                lockMutation.mutate({
                  startDate: lockConfirm.period.startDate,
                  note: lockConfirm.note || undefined,
                })
              }
              className="rounded-md bg-amber-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-60"
            >
              {lockMutation.isPending ? 'Locking…' : 'Lock period'}
            </button>
            <button
              type="button"
              onClick={() => {
                setLockConfirm(null);
                setError(null);
              }}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {unlockConfirm && (
        <div className="mb-6 rounded-lg border border-red-300 bg-red-50 p-4">
          <p className="text-sm font-semibold text-red-900">Unlock pay period?</p>
          <p className="mt-2 text-sm text-red-800">
            Unlocking <strong>{formatDateRange(unlockConfirm.period)}</strong> reopens these dates
            for editing. Payroll that was already processed for this period may become inconsistent.
          </p>
          <div className="mt-4">
            <label htmlFor="unlock-reason" className="block text-xs font-medium text-red-900">
              Reason for reopening (required)
            </label>
            <textarea
              id="unlock-reason"
              value={unlockConfirm.reason}
              onChange={(e) => setUnlockConfirm({ ...unlockConfirm, reason: e.target.value })}
              className={`${inputClass} mt-1 text-sm`}
              rows={2}
              placeholder="e.g., Correction needed for Jane's missed punch on 2026-07-27"
            />
            {!unlockConfirm.reason && (
              <p className="mt-1 text-xs text-red-600">Reason is required</p>
            )}
          </div>
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              disabled={unlockMutation.isPending || !unlockConfirm.reason}
              onClick={() =>
                unlockMutation.mutate({
                  startDate: unlockConfirm.period.startDate,
                  reason: unlockConfirm.reason,
                })
              }
              className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
            >
              {unlockMutation.isPending ? 'Unlocking…' : 'Unlock period'}
            </button>
            <button
              type="button"
              onClick={() => {
                setUnlockConfirm(null);
                setError(null);
              }}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        {periods.isLoading && <div className="p-6 text-slate-500">Loading…</div>}
        {periods.isError && (
          <div className="p-6 text-red-700">
            Failed to load pay periods: {(periods.error as Error).message}
          </div>
        )}
        {periods.data && periods.data.length === 0 && (
          <div className="p-6 text-slate-500">No pay periods yet.</div>
        )}
        {periods.data && periods.data.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Period</th>
                  <th className="px-4 py-3">Hours</th>
                  <th className="px-4 py-3">Workers</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {periods.data.map((period) => (
                  <tr key={period.startDate} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-slate-900">
                          {formatDateRange(period)}
                        </span>
                        {period.isCurrent && (
                          <span className="inline-flex rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                            Current
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{period.totalHours.toFixed(1)}h</td>
                    <td className="px-4 py-3 text-slate-600">{period.workerCount}</td>
                    <td className="px-4 py-3">
                      <div className="space-y-1">
                        {period.status === 'locked' ? (
                          <>
                            <div className="inline-flex rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                              Locked
                            </div>
                            {period.lockedByName && (
                              <p className="text-xs text-slate-500">by {period.lockedByName}</p>
                            )}
                            {period.lockedAt && (
                              <p className="text-xs text-slate-500">
                                {new Date(period.lockedAt).toLocaleDateString()}
                              </p>
                            )}
                            {period.note && (
                              <p className="text-xs text-slate-600">
                                <strong>Note:</strong> {period.note}
                              </p>
                            )}
                          </>
                        ) : (
                          <div className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                            Open
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {canLock && (
                        <div className="inline-flex gap-2">
                          {period.status === 'open' ? (
                            <button
                              type="button"
                              onClick={() => setLockConfirm({ period, note: '' })}
                              className="text-sm font-medium text-brand-600 hover:text-brand-800"
                            >
                              Lock
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setUnlockConfirm({ period, reason: '' })}
                              className="text-sm font-medium text-red-600 hover:text-red-800"
                            >
                              Unlock
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function formatDateRange(period: PayPeriodSummary): string {
  const start = new Date(period.startDate);
  const end = new Date(period.endDate);
  const monthStart = start.toLocaleString('en-US', { month: 'short', day: 'numeric' });
  const monthEnd = end.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  return `${monthStart} – ${monthEnd}`;
}

const inputClass =
  'w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200';
