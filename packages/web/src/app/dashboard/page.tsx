'use client';

import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PERMISSIONS, can, type Role } from '@punchclock/shared';
import { apiClient } from '@/lib/api-client';
import { getSocket } from '@/lib/ws-client';

interface TeamStatus {
  totalActive: number;
  clockedIn: number;
  lastPunch: {
    recordedAt: string;
    userName: string;
    eventType: string;
  } | null;
}

interface CostOfLabor {
  period: { fromDate: string; toDate: string };
  scheduled: number;
  actual: number;
  budget: number | null;
  weeks: number;
  overBudget: boolean;
}

interface Me {
  role: Role;
}

export default function DashboardOverviewPage() {
  const qc = useQueryClient();
  const me = useQuery<Me>({
    queryKey: ['auth', 'me'],
    queryFn: () => apiClient.get('/auth/me'),
    staleTime: 5 * 60 * 1000,
  });
  const role = me.data?.role;
  const canSeeCost = role ? can(role, PERMISSIONS.VIEW_OVERVIEW_COST) : false;

  const status = useQuery<TeamStatus>({
    queryKey: ['admin', 'team-status'],
    queryFn: () => apiClient.get('/api/v1/admin/team-status'),
    refetchInterval: 15_000,
  });

  const period = currentWeekRange();
  const cost = useQuery<CostOfLabor>({
    queryKey: ['admin', 'cost-of-labor', period.fromDate, period.toDate],
    queryFn: () =>
      apiClient.get(`/api/v1/admin/cost-of-labor?from=${period.fromDate}&to=${period.toDate}`),
    enabled: canSeeCost,
  });

  useEffect(() => {
    const token =
      typeof document !== 'undefined'
        ? (document.cookie.match(/(?:^|;\s*)pc_token=([^;]+)/)?.[1] ?? null)
        : null;
    if (!token) return;
    const socket = getSocket(decodeURIComponent(token));
    if (!socket) return;
    const invalidate = () => qc.invalidateQueries({ queryKey: ['admin', 'team-status'] });
    socket.on('time:punch-in', invalidate);
    socket.on('time:punch-out', invalidate);
    return () => {
      socket.off('time:punch-in', invalidate);
      socket.off('time:punch-out', invalidate);
    };
  }, [qc]);

  const data = status.data;
  const lastPunchLabel = data?.lastPunch
    ? `${formatTime(data.lastPunch.recordedAt)} · ${data.lastPunch.userName} ${verb(data.lastPunch.eventType)}`
    : '—';

  return (
    <div>
      <div className="mb-8 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Team overview</h1>
          <p className="text-slate-600">Real-time status of everyone in your organization.</p>
        </div>
        <span className="text-xs text-slate-500">{status.isFetching ? 'Refreshing…' : 'Live'}</span>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <StatCard
          label="Clocked in now"
          value={data ? data.clockedIn : '…'}
          accent="text-emerald-600"
        />
        <StatCard label="Total employees" value={data ? data.totalActive : '…'} />
        <StatCard label="Last punch" value={lastPunchLabel} small />
      </div>

      {canSeeCost && <LaborCostCard data={cost.data} loading={cost.isLoading} period={period} />}
    </div>
  );
}

function LaborCostCard({
  data,
  loading,
  period,
}: {
  data: CostOfLabor | undefined;
  loading: boolean;
  period: { fromDate: string; toDate: string };
}) {
  const fmt = (n: number) =>
    n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  const overBudget = !!data?.overBudget;

  return (
    <section
      className={`mt-6 rounded-lg border p-6 shadow-sm ${
        overBudget ? 'border-rose-300 bg-rose-50' : 'border-emerald-300 bg-emerald-50'
      }`}
    >
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold text-slate-900">Labor cost</h2>
        <span className="text-xs text-slate-600">
          {period.fromDate} → {period.toDate}
        </span>
      </div>
      {loading && <p className="mt-3 text-sm text-slate-600">Loading…</p>}
      {data && (
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
          <CostStat label="Scheduled" value={fmt(data.scheduled)} />
          <CostStat
            label="Actual so far"
            value={fmt(data.actual)}
            accent={overBudget ? 'text-rose-700' : 'text-emerald-700'}
          />
          <CostStat
            label="Weekly budget"
            value={data.budget !== null ? fmt(data.budget) : 'Not set'}
            hint={
              data.budget === null
                ? 'Set one in Settings → Labor budget'
                : `${data.weeks}-week period`
            }
          />
        </div>
      )}
      {data && data.budget !== null && (
        <p className={`mt-4 text-sm ${overBudget ? 'text-rose-700' : 'text-emerald-700'}`}>
          {overBudget
            ? `Over budget by ${fmt(data.actual - data.budget)}.`
            : `${fmt(data.budget - data.actual)} of budget remaining.`}
        </p>
      )}
    </section>
  );
}

function CostStat({
  label,
  value,
  accent,
  hint,
}: {
  label: string;
  value: string;
  accent?: string;
  hint?: string;
}) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${accent ?? 'text-slate-900'}`}>
        {value}
      </div>
      {hint && <div className="text-xs text-slate-500">{hint}</div>}
    </div>
  );
}

function currentWeekRange(): { fromDate: string; toDate: string } {
  const now = new Date();
  const day = now.getDay(); // 0 = Sun
  const diff = (day + 6) % 7; // back to Mon
  const start = new Date(now);
  start.setDate(now.getDate() - diff);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return { fromDate: toIso(start), toDate: toIso(end) };
}

function toIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

interface StatCardProps {
  label: string;
  value: string | number;
  accent?: string;
  small?: boolean;
}

function StatCard({ label, value, accent, small }: StatCardProps) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <div className="text-sm uppercase tracking-wide text-slate-500">{label}</div>
      <div
        className={`mt-2 font-semibold text-slate-900 ${accent ?? ''} ${small ? 'text-lg' : 'text-3xl'}`}
      >
        {value}
      </div>
    </div>
  );
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function verb(eventType: string): string {
  switch (eventType) {
    case 'punch_in':
      return 'punched in';
    case 'punch_out':
      return 'punched out';
    case 'break_start':
      return 'started a break';
    case 'break_end':
      return 'ended their break';
    default:
      return eventType;
  }
}
