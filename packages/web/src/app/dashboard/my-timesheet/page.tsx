'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
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
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function MyTimesheetPage() {
  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeek(new Date()));
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
      {ts.isLoading && <p className="mt-4 text-sm text-slate-500">Loading…</p>}
      {ts.isError && (
        <p className="mt-4 text-sm text-rose-600">
          Couldn&apos;t load your timesheet. Try again in a moment.
        </p>
      )}
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
