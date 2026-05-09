'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

interface ApiUser {
  id: string;
  email: string;
  phone: string | null;
  first_name: string | null;
  last_name: string | null;
  role: 'owner' | 'manager' | 'employee' | 'viewer';
  pay_rate: string | null;
  status: 'active' | 'inactive' | 'archived';
  last_login_at: string | null;
  created_at: string;
}

interface NewUserForm {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role: ApiUser['role'];
  payRate: string;
}

const EMPTY_FORM: NewUserForm = {
  email: '',
  password: '',
  firstName: '',
  lastName: '',
  role: 'employee',
  payRate: '',
};

export default function TeamPage() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<NewUserForm>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);

  const users = useQuery<ApiUser[]>({
    queryKey: ['admin', 'users'],
    queryFn: () => apiClient.get('/api/v1/admin/users'),
  });

  const createUser = useMutation({
    mutationFn: (input: NewUserForm) =>
      apiClient.post('/api/v1/admin/users', {
        email: input.email.trim(),
        password: input.password,
        firstName: input.firstName.trim() || undefined,
        lastName: input.lastName.trim() || undefined,
        role: input.role,
        payRate: input.payRate ? Number(input.payRate) : undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'users'] });
      setForm(EMPTY_FORM);
      setShowForm(false);
      setFormError(null);
    },
    onError: (err: Error) => setFormError(err.message),
  });

  const archiveUser = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/api/v1/admin/users/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'users'] }),
  });

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    createUser.mutate(form);
  }

  function onArchive(user: ApiUser) {
    const label = displayName(user);
    if (!confirm(`Archive ${label}? They will no longer be able to sign in.`)) return;
    archiveUser.mutate(user.id);
  }

  return (
    <div>
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">Team</h1>
        <button
          type="button"
          onClick={() => {
            setShowForm((v) => !v);
            setFormError(null);
          }}
          className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-700"
        >
          {showForm ? 'Cancel' : 'Add user'}
        </button>
      </div>

      {showForm && (
        <form
          onSubmit={onSubmit}
          className="mb-8 grid grid-cols-1 gap-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm md:grid-cols-2"
        >
          <Field label="Email">
            <input
              type="email"
              required
              autoComplete="off"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className={inputClass}
            />
          </Field>
          <Field label="Initial password">
            <input
              type="text"
              required
              minLength={8}
              autoComplete="off"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              className={inputClass}
              placeholder="≥ 8 characters"
            />
          </Field>
          <Field label="First name">
            <input
              type="text"
              value={form.firstName}
              onChange={(e) => setForm({ ...form, firstName: e.target.value })}
              className={inputClass}
            />
          </Field>
          <Field label="Last name">
            <input
              type="text"
              value={form.lastName}
              onChange={(e) => setForm({ ...form, lastName: e.target.value })}
              className={inputClass}
            />
          </Field>
          <Field label="Role">
            <select
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value as ApiUser['role'] })}
              className={inputClass}
            >
              <option value="employee">Employee</option>
              <option value="manager">Manager</option>
              <option value="viewer">Viewer</option>
              <option value="owner">Owner</option>
            </select>
          </Field>
          <Field label="Hourly pay rate (optional)">
            <input
              type="number"
              min={0}
              step="0.01"
              value={form.payRate}
              onChange={(e) => setForm({ ...form, payRate: e.target.value })}
              className={inputClass}
            />
          </Field>
          {formError && (
            <div className="md:col-span-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {formError}
            </div>
          )}
          <div className="md:col-span-2 flex justify-end">
            <button
              type="submit"
              disabled={createUser.isPending}
              className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-700 disabled:opacity-60"
            >
              {createUser.isPending ? 'Adding…' : 'Add to team'}
            </button>
          </div>
        </form>
      )}

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        {users.isLoading && <div className="p-6 text-slate-500">Loading…</div>}
        {users.isError && (
          <div className="p-6 text-red-700">
            Failed to load team: {(users.error as Error).message}
          </div>
        )}
        {users.data && users.data.length === 0 && (
          <div className="p-6 text-slate-500">No users yet — add your first worker above.</div>
        )}
        {users.data && users.data.length > 0 && (
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Last login</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {users.data.map((u) => (
                <tr key={u.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-900">{displayName(u)}</td>
                  <td className="px-4 py-3 text-slate-600">{u.email}</td>
                  <td className="px-4 py-3 capitalize text-slate-600">{u.role}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={u.status} />
                  </td>
                  <td className="px-4 py-3 text-slate-500">
                    {u.last_login_at ? new Date(u.last_login_at).toLocaleString() : '—'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {u.status === 'active' && u.role !== 'owner' && (
                      <button
                        type="button"
                        onClick={() => onArchive(u)}
                        disabled={archiveUser.isPending}
                        className="text-sm text-red-600 hover:text-red-800 disabled:opacity-50"
                      >
                        Archive
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      {children}
    </label>
  );
}

function StatusBadge({ status }: { status: ApiUser['status'] }) {
  const styles: Record<ApiUser['status'], string> = {
    active: 'bg-green-100 text-green-700',
    inactive: 'bg-slate-100 text-slate-600',
    archived: 'bg-slate-200 text-slate-500',
  };
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${styles[status]}`}>
      {status}
    </span>
  );
}

function displayName(u: ApiUser): string {
  const name = [u.first_name, u.last_name].filter(Boolean).join(' ').trim();
  return name || u.email;
}

const inputClass =
  'w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200';
