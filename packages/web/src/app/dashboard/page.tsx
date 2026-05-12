'use client';

import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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

export default function DashboardOverviewPage() {
  const qc = useQueryClient();
  const status = useQuery<TeamStatus>({
    queryKey: ['admin', 'team-status'],
    queryFn: () => apiClient.get('/api/v1/admin/team-status'),
    refetchInterval: 15_000,
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
    </div>
  );
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
