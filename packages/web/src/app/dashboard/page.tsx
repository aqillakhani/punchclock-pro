'use client';

import { useLiveTeam } from '@/lib/hooks/useLiveTeam';

export default function DashboardOverviewPage() {
  const { clockedIn, total, lastEvent } = useLiveTeam();
  return (
    <div>
      <h1 className="mb-2 text-2xl font-semibold text-slate-900">Team overview</h1>
      <p className="mb-8 text-slate-600">
        Real-time status of everyone in your organization.
      </p>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <StatCard label="Clocked in now" value={clockedIn} />
        <StatCard label="Total employees" value={total} />
        <StatCard label="Last punch" value={lastEvent ?? '—'} />
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <div className="text-sm uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-2 text-3xl font-semibold text-slate-900">{value}</div>
    </div>
  );
}
