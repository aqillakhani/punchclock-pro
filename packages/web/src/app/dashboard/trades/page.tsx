'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PERMISSIONS, can, type Role } from '@punchclock/shared';
import { apiClient } from '@/lib/api-client';

interface Me {
  id: string;
  role: Role;
}

interface MyShift {
  id: string;
  scheduled_date: string;
  shift_start: string;
  shift_end: string;
  duration_minutes: number;
  shift_type: 'standard' | 'overtime' | 'double' | 'time_off';
  status: 'scheduled' | 'completed' | 'cancelled';
}

interface Trade {
  id: string;
  shift_id: string;
  from_user_id: string;
  to_user_id: string | null;
  status: 'open' | 'accepted' | 'approved' | 'rejected' | 'cancelled';
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
  from_first_name: string | null;
  from_last_name: string | null;
  to_first_name: string | null;
  to_last_name: string | null;
  scheduled_date: string;
  shift_start: string;
  shift_end: string;
  duration_minutes: number;
}

interface AdminTrade extends Trade {
  from_email: string;
  to_email: string | null;
}

export default function TradesPage() {
  const me = useQuery<Me & { first_name: string | null; last_name: string | null; email: string }>({
    queryKey: ['auth', 'me'],
    queryFn: () => apiClient.get('/auth/me'),
    staleTime: 5 * 60 * 1000,
  });
  const role = me.data?.role;
  const myId = me.data?.id;

  const canPost = role ? can(role, PERMISSIONS.POST_TRADE) : false;
  const canAccept = role ? can(role, PERMISSIONS.ACCEPT_TRADE) : false;
  const canApprove = role ? can(role, PERMISSIONS.APPROVE_TRADE) : false;
  const canView = role ? can(role, PERMISSIONS.VIEW_TRADES) : false;

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Shift trades</h1>
        <p className="text-sm text-slate-600">
          Post a shift you can&apos;t work, or pick up an open one. Final swap needs a manager
          sign-off.
        </p>
      </header>

      {canPost && <PostForm />}
      {canView && myId && <TradeBoard myId={myId} canAccept={canAccept} />}
      {canApprove && <ApprovalsQueue />}
    </div>
  );
}

// ---- Post a trade ---------------------------------------------------

function PostForm() {
  const queryClient = useQueryClient();
  const [shiftId, setShiftId] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Next 14 days of my own scheduled shifts — only "standard" shifts
  // are eligible for trade.
  const today = toIso(new Date());
  const inTwoWeeks = toIso(addDays(new Date(), 14));
  const mine = useQuery<MyShift[]>({
    queryKey: ['me', 'schedule', today, inTwoWeeks],
    queryFn: () => apiClient.get(`/api/v1/me/schedule?from=${today}&to=${inTwoWeeks}`),
  });

  // Existing open trades from /me/shift-trade so we hide already-traded
  // shifts from the picker.
  const myTrades = useQuery<Trade[]>({
    queryKey: ['me', 'shift-trade'],
    queryFn: () => apiClient.get('/api/v1/me/shift-trade'),
  });
  const lockedShiftIds = useMemo(() => {
    const s = new Set<string>();
    for (const t of myTrades.data ?? []) {
      if (t.status === 'open' || t.status === 'accepted') s.add(t.shift_id);
    }
    return s;
  }, [myTrades.data]);

  const eligible = (mine.data ?? []).filter(
    (s) => s.shift_type === 'standard' && s.status === 'scheduled' && !lockedShiftIds.has(s.id),
  );

  const mutation = useMutation({
    mutationFn: (body: { shiftId: string }) => apiClient.post('/api/v1/me/shift-trade', body),
    onSuccess: () => {
      setShiftId('');
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['me', 'shift-trade'] });
    },
    onError: (err: Error) => setError(err.message),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!shiftId) {
      setError('Pick one of your upcoming shifts.');
      return;
    }
    mutation.mutate({ shiftId });
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-base font-semibold text-slate-900">Post one of your shifts</h2>
      <form onSubmit={handleSubmit} className="mt-4 flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-64">
          <label className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Shift
          </label>
          <select value={shiftId} onChange={(e) => setShiftId(e.target.value)} className={inputCls}>
            <option value="">Choose a shift…</option>
            {eligible.map((s) => (
              <option key={s.id} value={s.id}>
                {fmtYmd(s.scheduled_date)} · {fmtTime(s.shift_start)}–{fmtTime(s.shift_end)} (
                {(s.duration_minutes / 60).toFixed(1)}h)
              </option>
            ))}
          </select>
          {eligible.length === 0 && !mine.isLoading && (
            <p className="mt-1 text-xs text-slate-500">
              No eligible upcoming shifts. (Already-posted shifts are hidden.)
            </p>
          )}
        </div>
        <button type="submit" disabled={mutation.isPending} className={btnPrimary}>
          {mutation.isPending ? 'Posting…' : 'Post for trade'}
        </button>
        {error && <span className="text-sm text-rose-600">{error}</span>}
        {mutation.isSuccess && !mutation.isPending && (
          <span className="text-sm text-emerald-600">Posted!</span>
        )}
      </form>
    </section>
  );
}

// ---- Trade board (open + mine) --------------------------------------

function TradeBoard({ myId, canAccept }: { myId: string; canAccept: boolean }) {
  const queryClient = useQueryClient();
  const trades = useQuery<Trade[]>({
    queryKey: ['me', 'shift-trade'],
    queryFn: () => apiClient.get('/api/v1/me/shift-trade'),
  });

  const accept = useMutation({
    mutationFn: (id: string) => apiClient.post(`/api/v1/me/shift-trade/${id}/accept`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['me', 'shift-trade'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'shift-trade'] });
    },
  });

  const open = (trades.data ?? []).filter((t) => t.status === 'open' && t.from_user_id !== myId);
  const mine = (trades.data ?? []).filter((t) => t.from_user_id === myId || t.to_user_id === myId);

  return (
    <>
      <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <header className="border-b border-slate-100 px-5 py-3">
          <h2 className="text-base font-semibold text-slate-900">Open trades</h2>
        </header>
        {trades.isLoading && <p className="p-5 text-sm text-slate-500">Loading…</p>}
        {open.length === 0 && !trades.isLoading && (
          <p className="p-5 text-sm text-slate-500">No open trades right now.</p>
        )}
        {open.length > 0 && (
          <ul className="divide-y divide-slate-100">
            {open.map((t) => (
              <li key={t.id} className="flex items-center justify-between px-5 py-3">
                <div>
                  <div className="font-medium text-slate-900">
                    {fmtYmd(t.scheduled_date)} · {fmtTime(t.shift_start)}–{fmtTime(t.shift_end)}
                  </div>
                  <div className="text-xs text-slate-500">
                    Posted by{' '}
                    {[t.from_first_name, t.from_last_name].filter(Boolean).join(' ') ||
                      'a coworker'}{' '}
                    · {(t.duration_minutes / 60).toFixed(1)}h
                  </div>
                </div>
                {canAccept && (
                  <button
                    type="button"
                    onClick={() => accept.mutate(t.id)}
                    disabled={accept.isPending}
                    className={btnPrimary}
                  >
                    Accept
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <header className="border-b border-slate-100 px-5 py-3">
          <h2 className="text-base font-semibold text-slate-900">My trades</h2>
        </header>
        {mine.length === 0 && !trades.isLoading && (
          <p className="p-5 text-sm text-slate-500">
            You haven&apos;t posted or accepted any trades.
          </p>
        )}
        {mine.length > 0 && (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-2 text-left">Shift</th>
                <th className="px-5 py-2 text-left">From → To</th>
                <th className="px-5 py-2 text-left">Status</th>
                <th className="px-5 py-2 text-left">Posted</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {mine.map((t) => (
                <tr key={t.id}>
                  <td className="px-5 py-3 text-slate-800">
                    {fmtYmd(t.scheduled_date)} · {fmtTime(t.shift_start)}–{fmtTime(t.shift_end)}
                  </td>
                  <td className="px-5 py-3 text-slate-700">
                    {nameOrEmpty(t.from_first_name, t.from_last_name)} →{' '}
                    {nameOrEmpty(t.to_first_name, t.to_last_name) || (
                      <span className="text-slate-400">unclaimed</span>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    <TradeStatusPill status={t.status} />
                  </td>
                  <td className="px-5 py-3 text-xs text-slate-500">{fmtDate(t.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}

// ---- Manager approval queue -----------------------------------------

function ApprovalsQueue() {
  const queryClient = useQueryClient();
  const q = useQuery<AdminTrade[]>({
    queryKey: ['admin', 'shift-trade', 'accepted'],
    queryFn: () => apiClient.get('/api/v1/admin/shift-trade?status=accepted'),
  });
  const decide = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: 'approved' | 'rejected' }) =>
      apiClient.post(`/api/v1/admin/shift-trade/${id}/decision`, { decision }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'shift-trade'] });
      queryClient.invalidateQueries({ queryKey: ['me', 'shift-trade'] });
      queryClient.invalidateQueries({ queryKey: ['me', 'schedule'] });
    },
  });

  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <header className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
        <h2 className="text-base font-semibold text-slate-900">Pending manager approval</h2>
        {q.data && q.data.length > 0 && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
            {q.data.length} waiting
          </span>
        )}
      </header>
      {q.isLoading && <p className="p-5 text-sm text-slate-500">Loading…</p>}
      {q.data?.length === 0 && (
        <p className="p-5 text-sm text-slate-500">No accepted trades waiting on approval.</p>
      )}
      {q.data && q.data.length > 0 && (
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-5 py-2 text-left">Shift</th>
              <th className="px-5 py-2 text-left">From → To</th>
              <th className="px-5 py-2 text-right">Decision</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {q.data.map((t) => (
              <tr key={t.id}>
                <td className="px-5 py-3 text-slate-800">
                  {fmtYmd(t.scheduled_date)} · {fmtTime(t.shift_start)}–{fmtTime(t.shift_end)}
                </td>
                <td className="px-5 py-3 text-slate-700">
                  <div>{nameOrEmpty(t.from_first_name, t.from_last_name) || t.from_email}</div>
                  <div className="text-xs text-slate-500">→</div>
                  <div>{nameOrEmpty(t.to_first_name, t.to_last_name) || t.to_email || '—'}</div>
                </td>
                <td className="px-5 py-3 text-right">
                  <div className="inline-flex gap-2">
                    <button
                      type="button"
                      disabled={decide.isPending}
                      onClick={() => decide.mutate({ id: t.id, decision: 'rejected' })}
                      className={btnGhost}
                    >
                      Reject
                    </button>
                    <button
                      type="button"
                      disabled={decide.isPending}
                      onClick={() => decide.mutate({ id: t.id, decision: 'approved' })}
                      className={btnApprove}
                    >
                      Approve swap
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

// ---- Helpers --------------------------------------------------------

function TradeStatusPill({ status }: { status: Trade['status'] }) {
  const styles: Record<Trade['status'], string> = {
    open: 'bg-sky-100 text-sky-800',
    accepted: 'bg-amber-100 text-amber-800',
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

function nameOrEmpty(first: string | null, last: string | null): string {
  return [first, last].filter(Boolean).join(' ').trim();
}

function fmtYmd(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) return ymd;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function fmtTime(hhmmss: string): string {
  return hhmmss.slice(0, 5);
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function toIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

const inputCls =
  'mt-1 block w-full rounded-md border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100';
const btnPrimary =
  'rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 disabled:bg-slate-300';
const btnGhost =
  'rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50';
const btnApprove =
  'rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:bg-slate-300';
