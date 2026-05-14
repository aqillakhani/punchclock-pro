'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

interface AuditRow {
  id: string;
  actor_user_id: string | null;
  resource_type: string;
  resource_id: string | null;
  action: string;
  changes: Record<string, unknown> | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
}

export default function AuditLogPage() {
  const today = new Date();
  const [from, setFrom] = useState(toIso(addDays(today, -29)));
  const [to, setTo] = useState(toIso(today));
  const [action, setAction] = useState('');

  const q = useQuery<AuditRow[]>({
    queryKey: ['admin', 'audit-logs', from, to, action],
    queryFn: () => {
      const params = new URLSearchParams({ from, to });
      if (action.trim()) params.set('action', action.trim());
      return apiClient.get(`/api/v1/admin/audit-logs?${params}`);
    },
  });

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of q.data ?? []) m.set(r.action, (m.get(r.action) ?? 0) + 1);
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [q.data]);

  return (
    <div>
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Audit log</h1>
          <p className="text-sm text-slate-600">
            Who did what, and when. Cap blocks, predictive overrides, manager approvals — all
            logged.
          </p>
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
          <Field label="Action contains">
            <input
              type="text"
              value={action}
              onChange={(e) => setAction(e.target.value)}
              placeholder="cap_blocked, predictive_override, …"
              className={`${inputClass} min-w-72`}
            />
          </Field>
        </div>
        {counts.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
            {counts.slice(0, 8).map(([a, n]) => (
              <button
                key={a}
                type="button"
                onClick={() => setAction(a)}
                className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-slate-700 hover:bg-slate-100"
              >
                {a} ({n})
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-3 text-left">When</th>
              <th className="px-3 py-3 text-left">Actor</th>
              <th className="px-3 py-3 text-left">Action</th>
              <th className="px-3 py-3 text-left">Resource</th>
              <th className="px-3 py-3 text-left">Details</th>
              <th className="px-3 py-3 text-left">IP</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {q.isLoading && (
              <tr>
                <td colSpan={6} className="p-6 text-slate-500">
                  Loading…
                </td>
              </tr>
            )}
            {q.data && q.data.length === 0 && (
              <tr>
                <td colSpan={6} className="p-6 text-slate-500">
                  No audit entries match this filter.
                </td>
              </tr>
            )}
            {q.data?.map((r) => (
              <tr key={r.id} className="align-top">
                <td className="whitespace-nowrap px-3 py-3 text-xs text-slate-600">
                  {fmtDateTime(r.created_at)}
                </td>
                <td className="px-3 py-3 text-slate-800">
                  {[r.first_name, r.last_name].filter(Boolean).join(' ') || r.email || '—'}
                </td>
                <td className="px-3 py-3">
                  <ActionPill action={r.action} />
                </td>
                <td className="px-3 py-3 text-xs text-slate-600">
                  <div>{r.resource_type}</div>
                  {r.resource_id && (
                    <div className="font-mono text-[10px] text-slate-400">{r.resource_id}</div>
                  )}
                </td>
                <td className="px-3 py-3 text-xs text-slate-600">
                  {r.changes ? (
                    <pre className="whitespace-pre-wrap font-mono text-[11px]">
                      {JSON.stringify(r.changes, null, 0)}
                    </pre>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="px-3 py-3 text-xs font-mono text-slate-500">
                  {r.ip_address ?? '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ActionPill({ action }: { action: string }) {
  const tone = action.startsWith('cap_blocked')
    ? 'bg-rose-100 text-rose-800'
    : action.startsWith('predictive_override')
      ? 'bg-amber-100 text-amber-800'
      : 'bg-slate-100 text-slate-700';
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}>
      {action}
    </span>
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

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function toIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const inputClass =
  'rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200';
