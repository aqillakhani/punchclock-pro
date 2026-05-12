'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

interface TimesheetRow {
  userId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: string;
  payRate: number;
  days: { date: string; hours: number }[];
  totalHours: number;
  regularHours: number;
  overtimeHours: number;
  doubleTimeHours: number;
  estimatedPay: number;
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function TimesheetsPage() {
  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeek(new Date()));

  const days = useMemo(() => buildDays(weekStart), [weekStart]);
  const fromIso = days[0]!.iso;
  const toIso = days[6]!.iso;

  const ts = useQuery<TimesheetRow[]>({
    queryKey: ['admin', 'timesheets', fromIso, toIso],
    queryFn: () => apiClient.get(`/api/v1/admin/timesheets?from=${fromIso}&to=${toIso}`),
  });

  const totals = useMemo(() => {
    const rows = ts.data ?? [];
    return rows.reduce(
      (acc, r) => {
        acc.total += r.totalHours;
        acc.regular += r.regularHours;
        acc.overtime += r.overtimeHours;
        acc.pay += r.estimatedPay;
        return acc;
      },
      { total: 0, regular: 0, overtime: 0, pay: 0 },
    );
  }, [ts.data]);

  return (
    <div>
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Timesheets</h1>
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
        <SummaryCard label="Total hours" value={fmtHours(totals.total)} />
        <SummaryCard label="Regular" value={fmtHours(totals.regular)} />
        <SummaryCard
          label="Overtime"
          value={fmtHours(totals.overtime)}
          tone={totals.overtime > 0 ? 'text-amber-600' : ''}
        />
        <SummaryCard label="Est. payroll" value={fmtMoney(totals.pay)} tone="text-emerald-600" />
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 text-left">Employee</th>
                {days.map((d) => (
                  <th key={d.iso} className="px-2 py-3 text-right">
                    <div>{DAY_LABELS[d.dayOfWeekMon]}</div>
                    <div className="text-slate-400">{d.date.getDate()}</div>
                  </th>
                ))}
                <th className="px-3 py-3 text-right">Total</th>
                <th className="px-3 py-3 text-right">OT</th>
                <th className="px-3 py-3 text-right">Est. pay</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {ts.isLoading && (
                <tr>
                  <td colSpan={11} className="p-6 text-slate-500">
                    Loading…
                  </td>
                </tr>
              )}
              {ts.data && ts.data.length === 0 && (
                <tr>
                  <td colSpan={11} className="p-6 text-slate-500">
                    No active employees this week.
                  </td>
                </tr>
              )}
              {ts.data?.map((row) => (
                <tr key={row.userId} className="hover:bg-slate-50/60">
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-900">{displayName(row)}</div>
                    <div className="text-xs capitalize text-slate-500">{row.role}</div>
                  </td>
                  {row.days.map((d) => (
                    <td
                      key={d.date}
                      className={`px-2 py-3 text-right tabular-nums ${
                        d.hours === 0 ? 'text-slate-300' : 'text-slate-700'
                      }`}
                    >
                      {d.hours === 0 ? '—' : d.hours.toFixed(1)}
                    </td>
                  ))}
                  <td className="px-3 py-3 text-right font-medium text-slate-900 tabular-nums">
                    {fmtHours(row.totalHours)}
                  </td>
                  <td
                    className={`px-3 py-3 text-right tabular-nums ${
                      row.overtimeHours > 0 ? 'font-medium text-amber-600' : 'text-slate-400'
                    }`}
                  >
                    {row.overtimeHours > 0 ? fmtHours(row.overtimeHours) : '—'}
                  </td>
                  <td className="px-3 py-3 text-right font-medium text-emerald-700 tabular-nums">
                    {row.payRate > 0 ? fmtMoney(row.estimatedPay) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function SummaryCard({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${tone ?? 'text-slate-900'}`}>
        {value}
      </div>
    </div>
  );
}

function displayName(r: TimesheetRow): string {
  const name = [r.firstName, r.lastName].filter(Boolean).join(' ').trim();
  return name || r.email;
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

function fmtMoney(n: number): string {
  return n.toLocaleString(undefined, { style: 'currency', currency: 'USD' });
}

const btnGhost =
  'rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50';
