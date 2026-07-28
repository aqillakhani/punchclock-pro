'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CORRECTION_REQUEST_TYPES,
  CORRECTION_STATUS,
  PERMISSIONS,
  can,
  type Role,
} from '@punchclock/shared';
import { apiClient } from '@/lib/api-client';

interface Me {
  id: string;
  role: Role;
  first_name: string | null;
  last_name: string | null;
  email: string;
}

interface CorrectionRequest {
  id: string;
  time_entry_id: string | null;
  request_type: string;
  original_punch_in_at: string | null;
  original_punch_out_at: string | null;
  requested_punch_in_at: string | null;
  requested_punch_out_at: string | null;
  reason: string;
  status: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  minutes_delta: number | null;
  created_at: string;
}

interface CorrectionQueueItem extends CorrectionRequest {
  user_id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  requester_email: string;
}

export default function CorrectionsPage() {
  const queryClient = useQueryClient();
  const me = useQuery<Me>({
    queryKey: ['auth', 'me'],
    queryFn: () => apiClient.get('/auth/me'),
    staleTime: 5 * 60 * 1000,
  });
  const role = me.data?.role;

  const canSubmit = role ? can(role, PERMISSIONS.SUBMIT_TIME_CORRECTION) : false;
  const canApprove = role ? can(role, PERMISSIONS.APPROVE_TIME_CORRECTION) : false;
  const canView = role ? can(role, PERMISSIONS.VIEW_TIME_CORRECTION) : false;

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Corrections</h1>
        <p className="text-sm text-slate-600">
          Request and manage time entry corrections. Submit a request for your punches or review
          pending corrections from your team.
        </p>
      </header>

      {canView && <MyRequests />}
      {canApprove && <PendingApprovals />}
    </div>
  );
}

// ---- My requests (employee side) ---

function MyRequests() {
  const queryClient = useQueryClient();
  const q = useQuery<CorrectionRequest[]>({
    queryKey: ['me', 'corrections'],
    queryFn: () => apiClient.get('/api/v1/me/corrections'),
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => apiClient.post(`/api/v1/me/corrections/${id}/cancel`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['me', 'corrections'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'corrections'] });
    },
  });

  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <header className="border-b border-slate-100 px-5 py-3">
        <h2 className="text-base font-semibold text-slate-900">My requests</h2>
      </header>
      {q.isLoading && <p className="p-5 text-sm text-slate-500">Loading…</p>}
      {q.data?.length === 0 && (
        <p className="p-5 text-sm text-slate-500">
          No correction requests yet. Use the Timesheet tab to fix a punch.
        </p>
      )}
      {q.data && q.data.length > 0 && (
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-5 py-2 text-left">Shift Date</th>
              <th className="px-5 py-2 text-left">Change</th>
              <th className="px-5 py-2 text-left">Hours</th>
              <th className="px-5 py-2 text-left">Reason</th>
              <th className="px-5 py-2 text-left">Status</th>
              <th className="px-5 py-2 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {q.data.map((r) => (
              <tr key={r.id}>
                <td className="px-5 py-3 text-slate-800">
                  {r.original_punch_in_at
                    ? fmtShiftDate(r.original_punch_in_at)
                    : fmtShiftDate(r.requested_punch_in_at ?? '')}
                </td>
                <td className="px-5 py-3 text-slate-700">
                  <ChangeDescription request={r} />
                </td>
                <td className="px-5 py-3">
                  <HoursDelta minutes={r.minutes_delta} />
                </td>
                <td className="px-5 py-3 text-slate-700">{r.reason}</td>
                <td className="px-5 py-3">
                  <StatusPill status={r.status} />
                </td>
                <td className="px-5 py-3 text-right">
                  {r.status === CORRECTION_STATUS.PENDING && (
                    <button
                      type="button"
                      disabled={cancelMutation.isPending}
                      onClick={() => cancelMutation.mutate(r.id)}
                      className={btnGhost}
                    >
                      Withdraw
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {q.isError && (
        <p className="p-5 text-sm text-rose-600">
          Couldn&apos;t load your corrections. Try again in a moment.
        </p>
      )}
    </section>
  );
}

// ---- Pending approvals (approver side) ---

function PendingApprovals() {
  const queryClient = useQueryClient();
  const q = useQuery<CorrectionQueueItem[]>({
    queryKey: ['admin', 'corrections', 'pending'],
    queryFn: () => apiClient.get('/api/v1/admin/corrections?status=pending'),
  });

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<
    Record<string, { inAt?: string; outAt?: string; note: string }>
  >({});

  const decide = useMutation({
    mutationFn: ({
      id,
      decision,
      note,
      overridePunchInAt,
      overridePunchOutAt,
    }: {
      id: string;
      decision: 'approved' | 'rejected';
      note?: string;
      overridePunchInAt?: string;
      overridePunchOutAt?: string;
    }) =>
      apiClient.post(`/api/v1/admin/corrections/${id}/decision`, {
        decision,
        note,
        overridePunchInAt,
        overridePunchOutAt,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'corrections'] });
      queryClient.invalidateQueries({ queryKey: ['me', 'corrections'] });
      setExpandedId(null);
      setOverrides({});
    },
  });

  function handleApprove(item: CorrectionQueueItem) {
    const override = overrides[item.id];
    decide.mutate({
      id: item.id,
      decision: 'approved',
      note: override?.note || undefined,
      overridePunchInAt: override?.inAt || undefined,
      overridePunchOutAt: override?.outAt || undefined,
    });
  }

  function handleReject(item: CorrectionQueueItem) {
    const override = overrides[item.id];
    decide.mutate({
      id: item.id,
      decision: 'rejected',
      note: override?.note || undefined,
    });
  }

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
        <div className="divide-y divide-slate-100">
          {q.data.map((item) => {
            const isExpanded = expandedId === item.id;
            const override = overrides[item.id] || { inAt: '', outAt: '', note: '' };
            return (
              <div key={item.id} className="p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-slate-900">
                      {[item.first_name, item.last_name].filter(Boolean).join(' ') || item.email}
                    </div>
                    <div className="text-xs text-slate-500">{item.email}</div>
                    <div className="mt-2 space-y-1 text-sm text-slate-700">
                      <div>
                        <span className="font-medium">Shift date:</span>{' '}
                        {item.original_punch_in_at
                          ? fmtShiftDate(item.original_punch_in_at)
                          : fmtShiftDate(item.requested_punch_in_at ?? '')}
                      </div>
                      <div>
                        <span className="font-medium">Change:</span>{' '}
                        <ChangeDescription request={item} />
                      </div>
                      <div>
                        <span className="font-medium">Hours:</span>{' '}
                        <HoursDelta minutes={item.minutes_delta} />
                      </div>
                      <div>
                        <span className="font-medium">Reason:</span> {item.reason}
                      </div>
                      <div>
                        <span className="font-medium">Requested by:</span> {item.requester_email}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      disabled={decide.isPending}
                      onClick={() => handleReject(item)}
                      className={btnGhost}
                    >
                      Reject
                    </button>
                    {/* Adjusting is the exception; approving as-filed is
                        the common case and must stay one click. */}
                    <button
                      type="button"
                      disabled={decide.isPending}
                      onClick={() => setExpandedId(isExpanded ? null : item.id)}
                      aria-expanded={isExpanded}
                      className={btnGhost}
                    >
                      {isExpanded ? 'Cancel adjust' : 'Adjust…'}
                    </button>
                    <button
                      type="button"
                      disabled={decide.isPending}
                      onClick={() => handleApprove(item)}
                      className={btnApprove}
                    >
                      Approve
                    </button>
                  </div>
                </div>

                {isExpanded && (
                  <div className="mt-4 space-y-3 border-t border-slate-100 pt-4">
                    <p className="text-xs text-slate-500">
                      Leave a time blank to accept what was requested. Anything you set here is
                      applied instead, and the employee is told what changed.
                    </p>
                    <div>
                      <label
                        htmlFor={`override-in-${item.id}`}
                        className="block text-xs font-medium uppercase tracking-wide text-slate-500"
                      >
                        Override punch in time (optional)
                      </label>
                      <input
                        id={`override-in-${item.id}`}
                        type="datetime-local"
                        value={override.inAt}
                        onChange={(e) =>
                          setOverrides({
                            ...overrides,
                            [item.id]: { ...override, inAt: e.target.value },
                          })
                        }
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label
                        htmlFor={`override-out-${item.id}`}
                        className="block text-xs font-medium uppercase tracking-wide text-slate-500"
                      >
                        Override punch out time (optional)
                      </label>
                      <input
                        id={`override-out-${item.id}`}
                        type="datetime-local"
                        value={override.outAt}
                        onChange={(e) =>
                          setOverrides({
                            ...overrides,
                            [item.id]: { ...override, outAt: e.target.value },
                          })
                        }
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label
                        htmlFor={`override-note-${item.id}`}
                        className="block text-xs font-medium uppercase tracking-wide text-slate-500"
                      >
                        Approval note (optional)
                      </label>
                      <textarea
                        id={`override-note-${item.id}`}
                        value={override.note}
                        onChange={(e) =>
                          setOverrides({
                            ...overrides,
                            [item.id]: { ...override, note: e.target.value },
                          })
                        }
                        maxLength={1000}
                        placeholder="Add a note visible to the employee…"
                        className={`${inputCls} resize-none`}
                        rows={3}
                      />
                    </div>
                    <div className="flex gap-2 pt-2">
                      <button
                        type="button"
                        disabled={decide.isPending}
                        onClick={() => handleApprove(item)}
                        className={btnPrimary}
                      >
                        Approve with these changes
                      </button>
                      <button
                        type="button"
                        onClick={() => setExpandedId(null)}
                        className={btnGhost}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {q.isError && (
        <p className="p-5 text-sm text-rose-600">
          Couldn&apos;t load pending corrections. Try again in a moment.
        </p>
      )}
    </section>
  );
}

// ---- Helpers -------

function ChangeDescription({ request }: { request: CorrectionRequest }) {
  if (request.request_type === CORRECTION_REQUEST_TYPES.ADD_ENTRY) {
    return <span className="text-emerald-700">Add missing shift</span>;
  }
  if (request.request_type === CORRECTION_REQUEST_TYPES.DELETE_ENTRY) {
    return <span className="text-rose-700">Delete entry</span>;
  }
  // edit_times
  const hasInChange =
    request.requested_punch_in_at && request.requested_punch_in_at !== request.original_punch_in_at;
  const hasOutChange =
    request.requested_punch_out_at &&
    request.requested_punch_out_at !== request.original_punch_out_at;

  const inLabel = hasInChange
    ? `In: ${fmtTime(request.original_punch_in_at)} → ${fmtTime(request.requested_punch_in_at)}`
    : null;
  const outLabel = hasOutChange
    ? `Out: ${fmtTime(request.original_punch_out_at)} → ${fmtTime(request.requested_punch_out_at)}`
    : null;

  return <span className="text-slate-700">{[inLabel, outLabel].filter(Boolean).join('; ')}</span>;
}

function HoursDelta({ minutes }: { minutes: number | null }) {
  if (minutes === null) return <span className="text-slate-500">—</span>;
  if (minutes === 0) return <span className="text-slate-700">No change</span>;

  const sign = minutes > 0 ? '+' : '−';
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  const parts = [h > 0 ? `${h}h` : null, m > 0 ? `${m}m` : null].filter(Boolean).join(' ');

  const color = minutes > 0 ? 'text-amber-600' : 'text-slate-600';
  return (
    <span className={color}>
      {sign}
      {parts}
    </span>
  );
}

function StatusPill({ status }: { status: string }) {
  const styles: Record<string, string> = {
    [CORRECTION_STATUS.PENDING]: 'bg-amber-100 text-amber-800',
    [CORRECTION_STATUS.APPROVED]: 'bg-emerald-100 text-emerald-800',
    [CORRECTION_STATUS.REJECTED]: 'bg-rose-100 text-rose-800',
    [CORRECTION_STATUS.CANCELLED]: 'bg-slate-100 text-slate-600',
  };
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium capitalize ${styles[status] || 'bg-slate-100 text-slate-600'}`}
    >
      {status}
    </span>
  );
}

function fmtShiftDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

const inputCls =
  'mt-1 block w-full rounded-md border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100';
const btnPrimary =
  'rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 disabled:bg-slate-300';
const btnGhost =
  'rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50';
const btnApprove =
  'rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:bg-slate-300';
