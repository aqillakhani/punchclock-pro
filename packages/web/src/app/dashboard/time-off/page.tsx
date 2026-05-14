'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PERMISSIONS, can, type Role } from '@punchclock/shared';
import { apiClient } from '@/lib/api-client';

interface Me {
  id: string;
  role: Role;
  first_name: string | null;
  last_name: string | null;
  email: string;
}

interface MyRequest {
  id: string;
  start_date: string;
  end_date: string;
  reason: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
}

interface PendingRequest extends MyRequest {
  user_id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
}

export default function TimeOffPage() {
  const queryClient = useQueryClient();
  const me = useQuery<Me>({
    queryKey: ['auth', 'me'],
    queryFn: () => apiClient.get('/auth/me'),
    staleTime: 5 * 60 * 1000,
  });
  const role = me.data?.role;

  const canSubmit = role ? can(role, PERMISSIONS.SUBMIT_TIME_OFF) : false;
  const canApprove = role ? can(role, PERMISSIONS.APPROVE_TIME_OFF) : false;
  const canViewMine = role ? can(role, PERMISSIONS.VIEW_TIME_OFF) : false;

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Time off</h1>
        <p className="text-sm text-slate-600">
          Request paid time off and track approvals. Managers see the pending queue at the bottom.
        </p>
      </header>

      {canSubmit && (
        <RequestForm
          onSubmitted={() => queryClient.invalidateQueries({ queryKey: ['me', 'time-off'] })}
        />
      )}
      {canViewMine && <MyRequests />}
      {canApprove && <PendingApprovals />}
    </div>
  );
}

// ---- Request form -----------------------------------------------------

function RequestForm({ onSubmitted }: { onSubmitted: () => void }) {
  const queryClient = useQueryClient();
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (body: { startDate: string; endDate: string; reason?: string }) =>
      apiClient.post('/api/v1/me/time-off', body),
    onSuccess: () => {
      setStartDate('');
      setEndDate('');
      setReason('');
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['me', 'time-off'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'time-off'] });
      onSubmitted();
    },
    onError: (err: Error) => setError(err.message),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!startDate || !endDate) {
      setError('Pick a start and end date.');
      return;
    }
    if (endDate < startDate) {
      setError('End date must be on or after start date.');
      return;
    }
    mutation.mutate({ startDate, endDate, reason: reason.trim() || undefined });
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-base font-semibold text-slate-900">Request time off</h2>
      <form onSubmit={handleSubmit} className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-4">
        <div>
          <label className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Start date
          </label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className={inputCls}
            required
          />
        </div>
        <div>
          <label className="text-xs font-medium uppercase tracking-wide text-slate-500">
            End date
          </label>
          <input
            type="date"
            value={endDate}
            min={startDate || undefined}
            onChange={(e) => setEndDate(e.target.value)}
            className={inputCls}
            required
          />
        </div>
        <div className="md:col-span-2">
          <label className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Reason <span className="text-slate-400">(optional)</span>
          </label>
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={512}
            placeholder="Vacation, doctor's visit, etc."
            className={inputCls}
          />
        </div>
        <div className="md:col-span-4 flex items-center gap-3">
          <button type="submit" disabled={mutation.isPending} className={btnPrimary}>
            {mutation.isPending ? 'Submitting…' : 'Submit request'}
          </button>
          {error && <span className="text-sm text-rose-600">{error}</span>}
          {mutation.isSuccess && !mutation.isPending && (
            <span className="text-sm text-emerald-600">
              Request submitted — your manager will be notified.
            </span>
          )}
        </div>
      </form>
    </section>
  );
}

// ---- My requests ------------------------------------------------------

function MyRequests() {
  const q = useQuery<MyRequest[]>({
    queryKey: ['me', 'time-off'],
    queryFn: () => apiClient.get('/api/v1/me/time-off'),
  });
  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <header className="border-b border-slate-100 px-5 py-3">
        <h2 className="text-base font-semibold text-slate-900">My requests</h2>
      </header>
      {q.isLoading && <p className="p-5 text-sm text-slate-500">Loading…</p>}
      {q.data?.length === 0 && (
        <p className="p-5 text-sm text-slate-500">You haven&apos;t submitted any requests yet.</p>
      )}
      {q.data && q.data.length > 0 && (
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-5 py-2 text-left">Dates</th>
              <th className="px-5 py-2 text-left">Reason</th>
              <th className="px-5 py-2 text-left">Status</th>
              <th className="px-5 py-2 text-left">Submitted</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {q.data.map((r) => (
              <tr key={r.id}>
                <td className="px-5 py-3 text-slate-800">{rangeLabel(r.start_date, r.end_date)}</td>
                <td className="px-5 py-3 text-slate-700">{r.reason ?? '—'}</td>
                <td className="px-5 py-3">
                  <StatusPill status={r.status} />
                </td>
                <td className="px-5 py-3 text-xs text-slate-500">{fmtDate(r.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

// ---- Pending approvals (manager+) ------------------------------------

function PendingApprovals() {
  const queryClient = useQueryClient();
  const q = useQuery<PendingRequest[]>({
    queryKey: ['admin', 'time-off', 'pending'],
    queryFn: () => apiClient.get('/api/v1/admin/time-off?status=pending'),
  });

  const decide = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: 'approved' | 'rejected' }) =>
      apiClient.post(`/api/v1/admin/time-off/${id}/decision`, { decision }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'time-off'] });
      queryClient.invalidateQueries({ queryKey: ['me', 'time-off'] });
      queryClient.invalidateQueries({ queryKey: ['me', 'schedule'] });
    },
  });

  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <header className="border-b border-slate-100 px-5 py-3 flex items-center justify-between">
        <h2 className="text-base font-semibold text-slate-900">Pending approvals</h2>
        {q.data && q.data.length > 0 && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
            {q.data.length} waiting
          </span>
        )}
      </header>
      {q.isLoading && <p className="p-5 text-sm text-slate-500">Loading…</p>}
      {q.data?.length === 0 && (
        <p className="p-5 text-sm text-slate-500">
          Nothing waiting. Nice work staying on top of it.
        </p>
      )}
      {q.data && q.data.length > 0 && (
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-5 py-2 text-left">Employee</th>
              <th className="px-5 py-2 text-left">Dates</th>
              <th className="px-5 py-2 text-left">Reason</th>
              <th className="px-5 py-2 text-left">Submitted</th>
              <th className="px-5 py-2 text-right">Decision</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {q.data.map((r) => (
              <tr key={r.id}>
                <td className="px-5 py-3">
                  <div className="font-medium text-slate-900">
                    {[r.first_name, r.last_name].filter(Boolean).join(' ') || r.email}
                  </div>
                  <div className="text-xs text-slate-500">{r.email}</div>
                </td>
                <td className="px-5 py-3 text-slate-800">{rangeLabel(r.start_date, r.end_date)}</td>
                <td className="px-5 py-3 text-slate-700">{r.reason ?? '—'}</td>
                <td className="px-5 py-3 text-xs text-slate-500">{fmtDate(r.created_at)}</td>
                <td className="px-5 py-3 text-right">
                  <div className="inline-flex gap-2">
                    <button
                      type="button"
                      disabled={decide.isPending}
                      onClick={() => decide.mutate({ id: r.id, decision: 'rejected' })}
                      className={btnGhost}
                    >
                      Reject
                    </button>
                    <button
                      type="button"
                      disabled={decide.isPending}
                      onClick={() => decide.mutate({ id: r.id, decision: 'approved' })}
                      className={btnApprove}
                    >
                      Approve
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

// ---- Helpers ----------------------------------------------------------

function StatusPill({ status }: { status: MyRequest['status'] }) {
  const styles: Record<MyRequest['status'], string> = {
    pending: 'bg-amber-100 text-amber-800',
    approved: 'bg-emerald-100 text-emerald-800',
    rejected: 'bg-rose-100 text-rose-800',
    cancelled: 'bg-slate-100 text-slate-600',
  };
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium capitalize ${styles[status]}`}
    >
      {status}
    </span>
  );
}

function rangeLabel(start: string, end: string): string {
  if (start === end) return fmtYmd(start);
  return `${fmtYmd(start)} → ${fmtYmd(end)}`;
}

function fmtYmd(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) return ymd;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

const inputCls =
  'mt-1 block w-full rounded-md border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100';
const btnPrimary =
  'rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 disabled:bg-slate-300';
const btnGhost =
  'rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50';
const btnApprove =
  'rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:bg-slate-300';
