'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PERMISSIONS, can, type Role } from '@punchclock/shared';
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

const PRESETS: { label: string; days: number }[] = [
  { label: 'Last 7 days', days: 7 },
  { label: 'Last 14 days', days: 14 },
  { label: 'This month', days: 30 },
  { label: 'Last 90 days', days: 90 },
];

export default function ReportsPage() {
  const today = new Date();
  const defaultTo = toIsoDate(today);
  const defaultFrom = toIsoDate(addDays(today, -13));

  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [jurisdiction, setJurisdiction] = useState<'federal' | 'california'>('federal');

  const me = useQuery<{ role: Role }>({
    queryKey: ['auth', 'me'],
    queryFn: () => apiClient.get('/auth/me'),
    staleTime: 5 * 60 * 1000,
  });
  const role = me.data?.role;
  const canExportPayroll = role ? can(role, PERMISSIONS.EXPORT_PAYROLL) : false;

  const rows = useQuery<TimesheetRow[]>({
    queryKey: ['admin', 'timesheets', from, to, jurisdiction],
    queryFn: () =>
      apiClient.get(`/api/v1/admin/timesheets?from=${from}&to=${to}&jurisdiction=${jurisdiction}`),
  });

  const totals = useMemo(() => {
    const r = rows.data ?? [];
    return r.reduce(
      (acc, x) => {
        acc.total += x.totalHours;
        acc.regular += x.regularHours;
        acc.overtime += x.overtimeHours;
        acc.doubleTime += x.doubleTimeHours;
        acc.pay += x.estimatedPay;
        return acc;
      },
      { total: 0, regular: 0, overtime: 0, doubleTime: 0, pay: 0 },
    );
  }, [rows.data]);

  function applyPreset(days: number) {
    const end = new Date();
    setFrom(toIsoDate(addDays(end, -(days - 1))));
    setTo(toIsoDate(end));
  }

  async function downloadAuthed(path: string, filename: string) {
    const token =
      typeof document === 'undefined'
        ? null
        : (document.cookie.match(/(?:^|;\s*)pc_token=([^;]+)/)?.[1] ?? null);
    const base =
      (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_API_BASE_URL) ??
      'http://localhost:4000';
    const res = await fetch(`${base}${path}`, {
      headers: token ? { Authorization: `Bearer ${decodeURIComponent(token)}` } : undefined,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Export failed (${res.status}): ${text.slice(0, 200)}`);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function downloadIIF() {
    void downloadAuthed(
      `/api/v1/admin/exports/payroll.iif?from=${from}&to=${to}&jurisdiction=${jurisdiction}`,
      `payroll_${from}_to_${to}.iif`,
    ).catch((e) => alert(e.message));
  }

  function downloadQboJson() {
    void downloadAuthed(
      `/api/v1/admin/exports/payroll.qbo.json?from=${from}&to=${to}&jurisdiction=${jurisdiction}`,
      `payroll_${from}_to_${to}.qbo.json`,
    ).catch((e) => alert(e.message));
  }

  function downloadCsv() {
    const data = rows.data ?? [];
    const header = [
      'Employee',
      'Email',
      'Role',
      'Total hours',
      'Regular hours',
      'Overtime hours',
      'Double-time hours',
      'Pay rate',
      'Estimated pay',
    ];
    const lines = [header.join(',')];
    for (const r of data) {
      const name = [r.firstName, r.lastName].filter(Boolean).join(' ').trim() || r.email;
      lines.push(
        [
          csvEscape(name),
          csvEscape(r.email),
          csvEscape(r.role),
          r.totalHours.toFixed(2),
          r.regularHours.toFixed(2),
          r.overtimeHours.toFixed(2),
          r.doubleTimeHours.toFixed(2),
          r.payRate.toFixed(2),
          r.estimatedPay.toFixed(2),
        ].join(','),
      );
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `payroll_${from}_to_${to}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div>
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Reports</h1>
          <p className="text-sm text-slate-600">Hours and payroll summary for a date range.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={downloadCsv}
            disabled={!rows.data || rows.data.length === 0}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-60"
          >
            ⬇ CSV
          </button>
          {canExportPayroll && (
            <>
              <button
                type="button"
                onClick={downloadIIF}
                disabled={!rows.data || rows.data.length === 0}
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-60"
                title="QuickBooks Desktop import format"
              >
                ⬇ QuickBooks (.iif)
              </button>
              <button
                type="button"
                onClick={downloadQboJson}
                disabled={!rows.data || rows.data.length === 0}
                className="rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-700 disabled:opacity-60"
                title="QuickBooks Online JournalEntry payload"
              >
                ⬇ QBO (.json)
              </button>
            </>
          )}
        </div>
      </div>

      <div className="mb-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="From">
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="To">
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="Overtime rules">
            <select
              value={jurisdiction}
              onChange={(e) => setJurisdiction(e.target.value as 'federal' | 'california')}
              className={inputClass}
            >
              <option value="federal">Federal (40h/week)</option>
              <option value="california">California (8h/day + 40h/week)</option>
            </select>
          </Field>
          <div className="ml-auto flex flex-wrap gap-1">
            {PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => applyPreset(p.days)}
                className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-5">
        <SummaryCard label="Total hours" value={fmtHours(totals.total)} />
        <SummaryCard label="Regular" value={fmtHours(totals.regular)} />
        <SummaryCard
          label="Overtime"
          value={fmtHours(totals.overtime)}
          tone={totals.overtime > 0 ? 'text-amber-600' : ''}
        />
        <SummaryCard
          label="Double-time"
          value={fmtHours(totals.doubleTime)}
          tone={totals.doubleTime > 0 ? 'text-purple-600' : ''}
        />
        <SummaryCard label="Est. payroll" value={fmtMoney(totals.pay)} tone="text-emerald-600" />
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3 text-left">Employee</th>
              <th className="px-4 py-3 text-left">Role</th>
              <th className="px-3 py-3 text-right">Hours</th>
              <th className="px-3 py-3 text-right">Regular</th>
              <th className="px-3 py-3 text-right">OT</th>
              <th className="px-3 py-3 text-right">Double</th>
              <th className="px-3 py-3 text-right">Rate</th>
              <th className="px-3 py-3 text-right">Est. pay</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.isLoading && (
              <tr>
                <td colSpan={8} className="p-6 text-slate-500">
                  Loading…
                </td>
              </tr>
            )}
            {rows.data && rows.data.length === 0 && (
              <tr>
                <td colSpan={8} className="p-6 text-slate-500">
                  No data for this range.
                </td>
              </tr>
            )}
            {rows.data?.map((r) => {
              const name = [r.firstName, r.lastName].filter(Boolean).join(' ').trim() || r.email;
              return (
                <tr key={r.userId} className="hover:bg-slate-50/60">
                  <td className="px-4 py-3 font-medium text-slate-900">{name}</td>
                  <td className="px-4 py-3 capitalize text-slate-600">{r.role}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{fmtHours(r.totalHours)}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{fmtHours(r.regularHours)}</td>
                  <td
                    className={`px-3 py-3 text-right tabular-nums ${
                      r.overtimeHours > 0 ? 'font-medium text-amber-600' : 'text-slate-400'
                    }`}
                  >
                    {r.overtimeHours > 0 ? fmtHours(r.overtimeHours) : '—'}
                  </td>
                  <td
                    className={`px-3 py-3 text-right tabular-nums ${
                      r.doubleTimeHours > 0 ? 'font-medium text-purple-600' : 'text-slate-400'
                    }`}
                  >
                    {r.doubleTimeHours > 0 ? fmtHours(r.doubleTimeHours) : '—'}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-slate-600">
                    {r.payRate > 0 ? fmtMoney(r.payRate) : '—'}
                  </td>
                  <td className="px-3 py-3 text-right font-medium text-emerald-700 tabular-nums">
                    {r.payRate > 0 ? fmtMoney(r.estimatedPay) : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </span>
      {children}
    </label>
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

function fmtHours(n: number): string {
  return `${n.toFixed(1)}h`;
}

function fmtMoney(n: number): string {
  return n.toLocaleString(undefined, { style: 'currency', currency: 'USD' });
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

const inputClass =
  'rounded-md border border-slate-300 px-3 py-2 text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200';
