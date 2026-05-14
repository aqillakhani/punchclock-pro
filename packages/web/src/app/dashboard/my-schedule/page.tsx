'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

interface MyShift {
  id: string;
  scheduled_date: string;
  shift_start: string;
  shift_end: string;
  duration_minutes: number;
  shift_type: 'standard' | 'overtime' | 'double' | 'time_off';
  required_break_minutes: number;
  status: 'scheduled' | 'completed' | 'cancelled';
  notes: string | null;
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function MySchedulePage() {
  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeek(new Date()));
  const days = useMemo(() => buildDays(weekStart), [weekStart]);
  const fromIso = days[0]!.iso;
  const toIso = days[6]!.iso;

  const sched = useQuery<MyShift[]>({
    queryKey: ['me', 'schedule', fromIso, toIso],
    queryFn: () => apiClient.get(`/api/v1/me/schedule?from=${fromIso}&to=${toIso}`),
  });

  const shiftsByDay = useMemo(() => {
    const m = new Map<string, MyShift[]>();
    for (const s of sched.data ?? []) {
      const list = m.get(s.scheduled_date) ?? [];
      list.push(s);
      m.set(s.scheduled_date, list);
    }
    return m;
  }, [sched.data]);

  const totalMinutes = (sched.data ?? [])
    .filter((s) => s.shift_type !== 'time_off' && s.status !== 'cancelled')
    .reduce((acc, s) => acc + s.duration_minutes, 0);

  return (
    <div>
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">My Schedule</h1>
          <p className="text-sm text-slate-600">
            Week of {fmtLongDate(days[0]!.date)} – {fmtLongDate(days[6]!.date)} ·{' '}
            <span className="font-medium text-slate-700">
              {fmtHours(totalMinutes / 60)} scheduled
            </span>
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

      <div className="grid grid-cols-1 gap-3 md:grid-cols-7">
        {days.map((d) => {
          const list = shiftsByDay.get(d.iso) ?? [];
          return (
            <div
              key={d.iso}
              className="min-h-32 rounded-lg border border-slate-200 bg-white p-3 shadow-sm"
            >
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
                {DAY_LABELS[d.dayOfWeekMon]}{' '}
                <span className="text-slate-400">{d.date.getDate()}</span>
              </div>
              <div className="mt-2 space-y-2">
                {list.length === 0 ? (
                  <div className="text-xs text-slate-300">Off</div>
                ) : (
                  list.map((s) => <ShiftCard key={s.id} shift={s} />)
                )}
              </div>
            </div>
          );
        })}
      </div>

      <p className="mt-4 text-xs text-slate-500">
        Need a change? Post a trade on the{' '}
        <a href="/dashboard/trades" className="font-medium text-brand-700 hover:underline">
          Trades
        </a>{' '}
        page or request time off in{' '}
        <a href="/dashboard/time-off" className="font-medium text-brand-700 hover:underline">
          Time off
        </a>
        .
      </p>
      {sched.isLoading && <p className="mt-4 text-sm text-slate-500">Loading…</p>}
    </div>
  );
}

function ShiftCard({ shift }: { shift: MyShift }) {
  if (shift.shift_type === 'time_off') {
    return (
      <div className="rounded-md border border-violet-200 bg-violet-50 px-2 py-1.5 text-xs">
        <div className="font-medium text-violet-900">Time off</div>
        {shift.notes && <div className="mt-0.5 text-violet-700">{shift.notes}</div>}
      </div>
    );
  }
  const cancelled = shift.status === 'cancelled';
  return (
    <div
      className={`rounded-md border px-2 py-1.5 text-xs ${
        cancelled
          ? 'border-slate-200 bg-slate-50 text-slate-400 line-through'
          : 'border-brand-200 bg-brand-50 text-brand-900'
      }`}
    >
      <div className="font-medium">
        {fmtTime(shift.shift_start)} – {fmtTime(shift.shift_end)}
      </div>
      <div className="mt-0.5 capitalize text-slate-600">
        {fmtHours(shift.duration_minutes / 60)} · {shift.shift_type}
      </div>
      {shift.notes && <div className="mt-0.5 text-slate-500">{shift.notes}</div>}
    </div>
  );
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

function fmtTime(hhmmss: string): string {
  // The API returns Postgres TIME like '14:00:00'. Strip seconds for display.
  return hhmmss.slice(0, 5);
}

const btnGhost =
  'rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50';
