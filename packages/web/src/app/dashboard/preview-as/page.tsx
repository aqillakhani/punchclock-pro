'use client';

import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient, setPreviewAsUserId } from '@/lib/api-client';

interface User {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  role: 'owner' | 'manager' | 'employee' | 'viewer';
}

export default function PreviewAsPage() {
  const router = useRouter();
  const qc = useQueryClient();

  const me = useQuery<{ id: string; role: User['role'] }>({
    queryKey: ['auth', 'me'],
    queryFn: () => apiClient.get('/auth/me'),
    staleTime: 5 * 60 * 1000,
  });

  const team = useQuery<User[]>({
    queryKey: ['admin', 'users'],
    queryFn: () => apiClient.get('/api/v1/admin/users'),
  });

  function previewAs(userId: string) {
    setPreviewAsUserId(userId);
    qc.invalidateQueries();
    router.push('/dashboard');
  }

  if (me.data && me.data.role !== 'owner') {
    return (
      <div className="rounded-lg border border-rose-200 bg-rose-50 p-5 text-sm text-rose-800">
        Preview-as is owner-only.
      </div>
    );
  }

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">Preview as worker</h1>
        <p className="mt-1 text-sm text-slate-600">
          Render the dashboard as one of your employees to verify their permissions match what you
          intended. Your owner session stays active — exit via the banner at the top.
        </p>
      </header>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3 text-left">Name</th>
              <th className="px-4 py-3 text-left">Email</th>
              <th className="px-4 py-3 text-left">Role</th>
              <th className="px-4 py-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {team.isLoading && (
              <tr>
                <td colSpan={4} className="p-6 text-slate-500">
                  Loading…
                </td>
              </tr>
            )}
            {team.data
              ?.filter((u) => u.id !== me.data?.id)
              .map((u) => (
                <tr key={u.id} className="hover:bg-slate-50/60">
                  <td className="px-4 py-3 text-slate-900">
                    {[u.first_name, u.last_name].filter(Boolean).join(' ') || '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{u.email}</td>
                  <td className="px-4 py-3 text-xs capitalize text-slate-700">{u.role}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => previewAs(u.id)}
                      className="rounded-md bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700"
                    >
                      Preview as {u.first_name ?? u.email}
                    </button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
