'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CORRECTION_REQUEST_TYPES, PERMISSIONS, can, type Role } from '@punchclock/shared';
import { apiClient } from '@/lib/api-client';

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$',
  PHP: '₱',
  INR: '₹',
  EUR: '€',
  GBP: '£',
};

interface DayHours {
  date: string;
  hours: number;
}

interface MyTimesheet {
  firstName: string | null;
  lastName: string | null;
  role: string;
  payRate: number;
  payCurrency: string;
  workerType: 'W2' | 'contractor_1099';
  days: DayHours[];
  totalHours: number;
  regularHours: number;
  overtimeHours: number;
  doubleTimeHours: number;
  estimatedPay: number;
}

interface MeWithFx {
  fx_rates: Record<string, number> | null;
  pay_currency: string;
  role: Role;
}

interface TimeEntry {
  id: string;
  punchInAt: string;
  punchOutAt: string | null;
  durationMinutes: number | null;
  grossMinutes: number | null;
  unpaidBreakMinutes: number | null;
  isManual: boolean;
  status: string;
}

interface CorrectionRequest {
  id: string;
  time_entry_id: string | null;
  status: string;
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function MyTimesheetPage() {
  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeek(new Date()));
  const [modalEntry, setModalEntry] = useState<TimeEntry | null>(null);
  const [addEntryMode, setAddEntryMode] = useState(false);
  const days = useMemo(() => buildDays(weekStart), [weekStart]);
  const fromIso = days[0]!.iso;
  const toIso = days[6]!.iso;

  const ts = useQuery<MyTimesheet>({
    queryKey: ['me', 'timesheet', fromIso, toIso],
    queryFn: () => apiClient.get(`/api/v1/me/timesheet?from=${fromIso}&to=${toIso}`),
  });

  const me = useQuery<MeWithFx>({
    queryKey: ['auth', 'me'],
    queryFn: () => apiClient.get('/auth/me'),
    staleTime: 5 * 60 * 1000,
  });

  const entries = useQuery<TimeEntry[]>({
    queryKey: ['me', 'time-entries', fromIso, toIso],
    queryFn: () => apiClient.get(`/api/v1/time-tracking/entries?from=${fromIso}&to=${toIso}`),
  });

  const corrections = useQuery<CorrectionRequest[]>({
    queryKey: ['me', 'corrections'],
    queryFn: () => apiClient.get('/api/v1/me/corrections'),
  });

  const fxRates = me.data?.fx_rates ?? {};

  const data = ts.data;
  const is1099 = data?.workerType === 'contractor_1099';
  const isOffshore = !!data && data.payCurrency !== 'USD';
  const fxRate = data ? (fxRates[data.payCurrency] ?? null) : null;
  const dailyByIso = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of data?.days ?? []) m.set(d.date, d.hours);
    return m;
  }, [data]);

  const canSubmitCorrection = me.data?.role
    ? can(me.data.role, PERMISSIONS.SUBMIT_TIME_CORRECTION)
    : false;

  const pendingEntryIds = useMemo(() => {
    const set = new Set<string>();
    for (const c of corrections.data ?? []) {
      if (c.status === 'pending' && c.time_entry_id) {
        set.add(c.time_entry_id);
      }
    }
    return set;
  }, [corrections.data]);

  return (
    <div>
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">My Timesheet</h1>
          <p className="text-sm text-slate-600">
            Week of {fmtLongDate(days[0]!.date)} – {fmtLongDate(days[6]!.date)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setWeekStart(addDays(weekStart, -7))}
            className={btnGhost}
          >
            ← Prev
          </button>
          <button
            type="button"
            onClick={() => setWeekStart(startOfWeek(new Date()))}
            className={btnGhost}
          >
            This week
          </button>
          <button
            type="button"
            onClick={() => setWeekStart(addDays(weekStart, 7))}
            className={btnGhost}
          >
            Next →
          </button>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-4">
        <SummaryCard
          label={is1099 ? 'Total billed' : 'Total hours'}
          value={fmtHours(data?.totalHours ?? 0)}
        />
        <SummaryCard
          label={is1099 ? 'Straight-time' : 'Regular'}
          value={fmtHours(data?.regularHours ?? 0)}
        />
        <SummaryCard
          label="Overtime"
          value={is1099 ? '—' : fmtHours(data?.overtimeHours ?? 0)}
          tone={!is1099 && (data?.overtimeHours ?? 0) > 0 ? 'text-amber-600' : ''}
        />
        <SummaryCard
          label="Est. pay"
          value={fmtMoney(data?.estimatedPay ?? 0, 'USD')}
          tone="text-emerald-600"
          subtext={
            isOffshore && fxRate !== null
              ? `≈ ${CURRENCY_SYMBOLS[data!.payCurrency] ?? ''}${fmtBigInt(
                  (data!.estimatedPay ?? 0) * fxRate,
                )} ${data!.payCurrency}`
              : undefined
          }
        />
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              {days.map((d) => (
                <th key={d.iso} className="px-2 py-3 text-center">
                  <div>{DAY_LABELS[d.dayOfWeekMon]}</div>
                  <div className="text-slate-400">{d.date.getDate()}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              {days.map((d) => {
                const h = dailyByIso.get(d.iso) ?? 0;
                return (
                  <td
                    key={d.iso}
                    className={`px-2 py-6 text-center text-lg font-semibold tabular-nums ${
                      h === 0 ? 'text-slate-300' : 'text-slate-800'
                    }`}
                  >
                    {h === 0 ? '—' : h.toFixed(1)}
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>

      {is1099 && (
        <p className="mt-4 text-xs text-slate-500">
          Contractors are paid straight-time — federal overtime rules (FLSA) don&apos;t apply.
        </p>
      )}

      {canSubmitCorrection && (
        <PunchesList
          entries={entries.data ?? []}
          entriesLoading={entries.isLoading}
          pendingEntryIds={pendingEntryIds}
          onEditEntry={(entry) => setModalEntry(entry)}
          onAddEntry={() => setAddEntryMode(true)}
        />
      )}

      {modalEntry && (
        <CorrectionModal
          entry={modalEntry}
          onClose={() => setModalEntry(null)}
          onSubmitted={() => {
            setModalEntry(null);
            corrections.refetch();
          }}
        />
      )}

      {addEntryMode && (
        <AddEntryModal
          onClose={() => setAddEntryMode(false)}
          onSubmitted={() => {
            setAddEntryMode(false);
            entries.refetch();
            corrections.refetch();
          }}
        />
      )}

      {ts.isLoading && <p className="mt-4 text-sm text-slate-500">Loading…</p>}
      {ts.isError && (
        <p className="mt-4 text-sm text-rose-600">
          Couldn&apos;t load your timesheet. Try again in a moment.
        </p>
      )}
    </div>
  );
}

// ---- Punches list -------

interface PunchesListProps {
  entries: TimeEntry[];
  entriesLoading: boolean;
  pendingEntryIds: Set<string>;
  onEditEntry: (entry: TimeEntry) => void;
  onAddEntry: () => void;
}

function PunchesList({
  entries,
  entriesLoading,
  pendingEntryIds,
  onEditEntry,
  onAddEntry,
}: PunchesListProps) {
  return (
    <section className="mt-8 rounded-lg border border-slate-200 bg-white shadow-sm">
      <header className="border-b border-slate-100 px-5 py-3 flex items-center justify-between">
        <h2 className="text-base font-semibold text-slate-900">Punches this week</h2>
        <button type="button" onClick={onAddEntry} className={btnPrimary}>
          + Missing a shift?
        </button>
      </header>

      {entriesLoading && <p className="p-5 text-sm text-slate-500">Loading…</p>}
      {!entriesLoading && entries.length === 0 && (
        <p className="p-5 text-sm text-slate-500">No punches this week yet.</p>
      )}
      {!entriesLoading && entries.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-2 text-left">Date</th>
                <th className="px-5 py-2 text-left">In → Out</th>
                <th className="px-5 py-2 text-left">Gross</th>
                <th className="px-5 py-2 text-left">Unpaid Break</th>
                <th className="px-5 py-2 text-left">Payable</th>
                <th className="px-5 py-2 text-left">Status</th>
                <th className="px-5 py-2 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {entries.map((entry) => {
                const isPending = pendingEntryIds.has(entry.id);
                return (
                  <tr key={entry.id}>
                    <td className="px-5 py-3">
                      {new Date(entry.punchInAt).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                      })}
                    </td>
                    <td className="px-5 py-3 text-slate-700">
                      {fmtTime(entry.punchInAt)} →{' '}
                      {entry.punchOutAt ? (
                        fmtTime(entry.punchOutAt)
                      ) : (
                        <span className="text-slate-400">in progress</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-slate-800 font-medium tabular-nums">
                      {entry.grossMinutes !== null ? fmtHours(entry.grossMinutes / 60) : '—'}
                    </td>
                    <td className="px-5 py-3 text-slate-700 tabular-nums">
                      {(entry.unpaidBreakMinutes ?? 0) > 0 ? `${entry.unpaidBreakMinutes}m` : '—'}
                    </td>
                    <td className="px-5 py-3 text-slate-800 font-medium tabular-nums">
                      {entry.durationMinutes !== null ? fmtHours(entry.durationMinutes / 60) : '—'}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        {entry.isManual && (
                          <span className="inline-block rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800">
                            Edited
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-3 text-right">
                      {isPending ? (
                        <span className="text-xs text-amber-700 font-medium">
                          Correction pending
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onEditEntry(entry)}
                          className={btnGhost}
                        >
                          Fix
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ---- Correction modal (edit/delete) -------

interface CorrectionModalProps {
  entry: TimeEntry;
  onClose: () => void;
  onSubmitted: () => void;
}

function CorrectionModal({ entry, onClose, onSubmitted }: CorrectionModalProps) {
  const queryClient = useQueryClient();
  const [action, setAction] = useState<'edit' | 'delete'>('edit');
  const [punchInAt, setPunchInAt] = useState(toDatetimeLocal(entry.punchInAt));
  const [punchOutAt, setPunchOutAt] = useState(
    entry.punchOutAt ? toDatetimeLocal(entry.punchOutAt) : '',
  );
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (body: {
      requestType: string;
      timeEntryId: string;
      requestedPunchInAt?: string;
      requestedPunchOutAt?: string;
      reason: string;
    }) => apiClient.post('/api/v1/me/corrections', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['me', 'corrections'] });
      queryClient.invalidateQueries({ queryKey: ['me', 'time-entries'] });
      onSubmitted();
    },
    onError: (err: Error) => setError(err.message),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!reason.trim()) {
      setError('Please tell your manager what went wrong.');
      return;
    }

    if (action === 'delete') {
      mutation.mutate({
        requestType: CORRECTION_REQUEST_TYPES.DELETE_ENTRY,
        timeEntryId: entry.id,
        reason: reason.trim(),
      });
    } else {
      // edit_times
      if (!punchInAt || !punchOutAt) {
        setError('Both in and out times are required.');
        return;
      }

      const inTime = new Date(punchInAt).toISOString();
      const outTime = new Date(punchOutAt).toISOString();

      if (new Date(outTime) <= new Date(inTime)) {
        setError('End time must be after start time.');
        return;
      }

      mutation.mutate({
        requestType: CORRECTION_REQUEST_TYPES.EDIT_TIMES,
        timeEntryId: entry.id,
        requestedPunchInAt: inTime,
        requestedPunchOutAt: outTime,
        reason: reason.trim(),
      });
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="rounded-lg bg-white shadow-lg max-w-md w-full mx-4 max-h-[90vh] overflow-auto">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="text-lg font-semibold text-slate-900">Request correction</h2>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-5">
          <div className="space-y-2">
            <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">
              What do you want to do?
            </label>
            <div className="flex gap-3">
              <label className="flex items-center">
                <input
                  type="radio"
                  value="edit"
                  checked={action === 'edit'}
                  onChange={(e) => setAction(e.target.value as 'edit' | 'delete')}
                  className="mr-2"
                />
                <span className="text-sm text-slate-700">Edit the times</span>
              </label>
              <label className="flex items-center">
                <input
                  type="radio"
                  value="delete"
                  checked={action === 'delete'}
                  onChange={(e) => setAction(e.target.value as 'edit' | 'delete')}
                  className="mr-2"
                />
                <span className="text-sm text-slate-700">Remove this entry</span>
              </label>
            </div>
          </div>

          {action === 'edit' && (
            <>
              <div>
                <label
                  htmlFor="punchIn"
                  className="block text-xs font-medium uppercase tracking-wide text-slate-500"
                >
                  Clock in time
                </label>
                <input
                  id="punchIn"
                  type="datetime-local"
                  value={punchInAt}
                  onChange={(e) => setPunchInAt(e.target.value)}
                  className={inputCls}
                  required
                />
              </div>
              <div>
                <label
                  htmlFor="punchOut"
                  className="block text-xs font-medium uppercase tracking-wide text-slate-500"
                >
                  Clock out time
                </label>
                <input
                  id="punchOut"
                  type="datetime-local"
                  value={punchOutAt}
                  onChange={(e) => setPunchOutAt(e.target.value)}
                  className={inputCls}
                  required
                />
              </div>
            </>
          )}

          <div>
            <label
              htmlFor="reason"
              className="block text-xs font-medium uppercase tracking-wide text-slate-500"
            >
              Why? (required)
            </label>
            <textarea
              id="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={1000}
              placeholder="Tell your manager what happened…"
              className={`${inputCls} resize-none`}
              rows={3}
              required
            />
          </div>

          {error && <p className="text-sm text-rose-600">{error}</p>}

          <div className="flex gap-2 pt-2">
            <button type="submit" disabled={mutation.isPending} className={btnPrimary}>
              {mutation.isPending ? 'Submitting…' : 'Submit request'}
            </button>
            <button type="button" onClick={onClose} className={btnGhost}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---- Add entry modal -------

interface AddEntryModalProps {
  onClose: () => void;
  onSubmitted: () => void;
}

function AddEntryModal({ onClose, onSubmitted }: AddEntryModalProps) {
  const queryClient = useQueryClient();
  const [date, setDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (body: {
      requestType: string;
      requestedPunchInAt: string;
      requestedPunchOutAt: string;
      reason: string;
    }) => apiClient.post('/api/v1/me/corrections', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['me', 'corrections'] });
      queryClient.invalidateQueries({ queryKey: ['me', 'time-entries'] });
      onSubmitted();
    },
    onError: (err: Error) => setError(err.message),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!date || !startTime || !endTime) {
      setError('Please fill in all time fields.');
      return;
    }

    if (!reason.trim()) {
      setError('Please tell your manager what went wrong.');
      return;
    }

    const inTime = new Date(`${date}T${startTime}`).toISOString();
    const outTime = new Date(`${date}T${endTime}`).toISOString();

    if (new Date(outTime) <= new Date(inTime)) {
      setError('End time must be after start time.');
      return;
    }

    mutation.mutate({
      requestType: CORRECTION_REQUEST_TYPES.ADD_ENTRY,
      requestedPunchInAt: inTime,
      requestedPunchOutAt: outTime,
      reason: reason.trim(),
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="rounded-lg bg-white shadow-lg max-w-md w-full mx-4">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="text-lg font-semibold text-slate-900">Report a missing shift</h2>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-5">
          <div>
            <label
              htmlFor="date"
              className="block text-xs font-medium uppercase tracking-wide text-slate-500"
            >
              Date
            </label>
            <input
              id="date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className={inputCls}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="start"
                className="block text-xs font-medium uppercase tracking-wide text-slate-500"
              >
                Start time
              </label>
              <input
                id="start"
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className={inputCls}
                required
              />
            </div>
            <div>
              <label
                htmlFor="end"
                className="block text-xs font-medium uppercase tracking-wide text-slate-500"
              >
                End time
              </label>
              <input
                id="end"
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className={inputCls}
                required
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="reason2"
              className="block text-xs font-medium uppercase tracking-wide text-slate-500"
            >
              Why? (required)
            </label>
            <textarea
              id="reason2"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={1000}
              placeholder="Tell your manager what happened…"
              className={`${inputCls} resize-none`}
              rows={3}
              required
            />
          </div>

          {error && <p className="text-sm text-rose-600">{error}</p>}

          <div className="flex gap-2 pt-2">
            <button type="submit" disabled={mutation.isPending} className={btnPrimary}>
              {mutation.isPending ? 'Submitting…' : 'Submit request'}
            </button>
            <button type="button" onClick={onClose} className={btnGhost}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  tone,
  subtext,
}: {
  label: string;
  value: string;
  tone?: string;
  subtext?: string;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${tone ?? 'text-slate-900'}`}>
        {value}
      </div>
      {subtext && <div className="mt-0.5 text-xs text-slate-500 tabular-nums">{subtext}</div>}
    </div>
  );
}

function fmtBigInt(n: number): string {
  return Math.round(n).toLocaleString();
}

function startOfWeek(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const day = x.getDay();
  const diff = (day + 6) % 7;
  x.setDate(x.getDate() - diff);
  return x;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function buildDays(weekStart: Date): { iso: string; date: Date; dayOfWeekMon: number }[] {
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDays(weekStart, i);
    return { iso: toIsoDate(date), date, dayOfWeekMon: i };
  });
}

function fmtLongDate(d: Date): string {
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function fmtHours(n: number): string {
  return `${n.toFixed(1)}h`;
}

function fmtMoney(n: number, currency: string): string {
  try {
    return n.toLocaleString(undefined, { style: 'currency', currency });
  } catch {
    // Fall back if currency code is unknown to the runtime ICU.
    return `${n.toFixed(2)} ${currency}`;
  }
}

const btnGhost =
  'rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50';
const btnPrimary =
  'rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 disabled:bg-slate-300';
const inputCls =
  'mt-1 block w-full rounded-md border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100';

function toDatetimeLocal(iso: string): string {
  // Convert ISO 8601 to datetime-local format (YYYY-MM-DDTHH:mm)
  const d = new Date(iso);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const date = String(d.getDate()).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${date}T${hours}:${minutes}`;
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}
