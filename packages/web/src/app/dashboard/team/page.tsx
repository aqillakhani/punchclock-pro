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
  has_password: boolean;
}

/** What the API returns after creating a user or re-issuing an invite. */
interface InviteResult {
  id: string;
  email: string;
  /** Null when the owner set a password directly — there is nothing to send. */
  setupUrl: string | null;
  /** False when mail is not configured, so the owner has to relay the link. */
  emailDelivered: boolean;
  inviteExpiresAt: string | null;
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
  const [invite, setInvite] = useState<InviteResult | null>(null);
  const [pendingArchive, setPendingArchive] = useState<ApiUser | null>(null);

  const users = useQuery<ApiUser[]>({
    queryKey: ['admin', 'users'],
    queryFn: () => apiClient.get('/api/v1/admin/users'),
  });

  const createUser = useMutation<InviteResult, Error, NewUserForm>({
    mutationFn: (input) =>
      apiClient.post('/api/v1/admin/users', {
        email: input.email.trim(),
        password: input.password || undefined,
        firstName: input.firstName.trim() || undefined,
        lastName: input.lastName.trim() || undefined,
        role: input.role,
        payRate: input.payRate ? Number(input.payRate) : undefined,
      }),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['admin', 'users'] });
      setForm(EMPTY_FORM);
      setShowForm(false);
      setFormError(null);
      // Only worth showing when there is a link to hand over.
      setInvite(result.setupUrl ? result : null);
    },
    onError: (err: Error) => setFormError(err.message),
  });

  const reissueInvite = useMutation<InviteResult, Error, string>({
    mutationFn: (id) => apiClient.post(`/api/v1/admin/users/${id}/invite`, {}),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['admin', 'users'] });
      setInvite(result);
      setFormError(null);
    },
    onError: (err: Error) => setFormError(err.message),
  });

  const archiveUser = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/api/v1/admin/users/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'users'] });
      setPendingArchive(null);
    },
  });

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    createUser.mutate(form);
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

      {invite?.setupUrl && <SetupLinkPanel invite={invite} onDismiss={() => setInvite(null)} />}

      {pendingArchive && (
        <div className="mb-6 rounded-lg border border-amber-300 bg-amber-50 p-4">
          <p className="text-sm text-amber-900">
            Archive <strong>{displayName(pendingArchive)}</strong>? They will no longer be able to
            sign in. Their time records are kept.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={archiveUser.isPending}
              onClick={() => archiveUser.mutate(pendingArchive.id)}
              className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
            >
              {archiveUser.isPending ? 'Archiving…' : 'Archive'}
            </button>
            <button
              type="button"
              onClick={() => setPendingArchive(null)}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

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
          <Field label="Initial password (optional)">
            <input
              type="text"
              minLength={8}
              autoComplete="off"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              className={inputClass}
              placeholder="Leave blank to generate a sign-in link"
            />
            <span className="mt-1 block text-xs text-slate-500">
              Leave blank and you&apos;ll get a link to send them, so they choose their own
              password.
            </span>
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
                    {u.last_login_at ? (
                      new Date(u.last_login_at).toLocaleString()
                    ) : u.has_password ? (
                      '—'
                    ) : (
                      <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                        No password set
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex items-center gap-3">
                      {u.status === 'active' && !u.has_password && (
                        <button
                          type="button"
                          onClick={() => reissueInvite.mutate(u.id)}
                          disabled={reissueInvite.isPending}
                          className="text-sm font-medium text-brand-600 hover:text-brand-800 disabled:opacity-50"
                        >
                          {reissueInvite.isPending ? 'Generating…' : 'Get sign-in link'}
                        </button>
                      )}
                      {u.status === 'active' && u.role !== 'owner' && (
                        <button
                          type="button"
                          onClick={() => setPendingArchive(u)}
                          disabled={archiveUser.isPending}
                          className="text-sm text-red-600 hover:text-red-800 disabled:opacity-50"
                        >
                          Archive
                        </button>
                      )}
                    </div>
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

/**
 * The link a new worker uses to choose their own password.
 *
 * It is shown rather than only emailed because email delivery is
 * optional in this product: with no mail provider configured the invite
 * would otherwise vanish into a log line and the worker could never sign
 * in — which is exactly what used to happen.
 */
function SetupLinkPanel({ invite, onDismiss }: { invite: InviteResult; onDismiss: () => void }) {
  const [copied, setCopied] = useState(false);
  const url = invite.setupUrl ?? '';

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Clipboard can be blocked (insecure origin, permissions). The
      // input below is selectable, so there is always a manual path.
      setCopied(false);
    }
  }

  return (
    <div className="mb-6 rounded-lg border border-brand-200 bg-brand-50 p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Sign-in link for {invite.email}</h2>
          <p className="mt-1 text-sm text-slate-700">
            {invite.emailDelivered
              ? 'We emailed this to them. You can also send it yourself.'
              : 'Email delivery is not set up, so this was not sent. Copy it and send it to them yourself.'}
            {invite.inviteExpiresAt && (
              <>
                {' '}
                It works once, and expires {new Date(invite.inviteExpiresAt).toLocaleDateString()}.
              </>
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 text-sm text-slate-500 hover:text-slate-700"
        >
          Dismiss
        </button>
      </div>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <label htmlFor="setup-link" className="sr-only">
          Sign-in link
        </label>
        <input
          id="setup-link"
          readOnly
          value={url}
          onFocus={(e) => e.currentTarget.select()}
          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-800 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
        />
        <button
          type="button"
          onClick={copy}
          className="shrink-0 rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          {copied ? 'Copied' : 'Copy link'}
        </button>
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
