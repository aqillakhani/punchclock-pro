'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PERMISSIONS, can, type Role } from '@punchclock/shared';
import { apiClient } from '@/lib/api-client';

interface MyDoc {
  id: string;
  document_type: DocumentType;
  storage_url: string | null;
  expires_at: string | null;
  verified_at: string | null;
  verified_by: string | null;
  uploaded_at: string;
}

interface AdminDoc extends MyDoc {
  user_id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
}

type DocumentType = 'i9' | 'w4' | 'driver_license' | 'food_handler' | 'liquor_license' | 'other';

const DOC_LABEL: Record<DocumentType, string> = {
  i9: 'I-9 (Employment eligibility)',
  w4: 'W-4 (Tax withholding)',
  driver_license: "Driver's license",
  food_handler: 'Food handler permit',
  liquor_license: 'Liquor license',
  other: 'Other',
};

export default function DocumentsPage() {
  const me = useQuery<{ role: Role }>({
    queryKey: ['auth', 'me'],
    queryFn: () => apiClient.get('/auth/me'),
    staleTime: 5 * 60 * 1000,
  });
  const role = me.data?.role;
  const canUpload = role ? can(role, PERMISSIONS.UPLOAD_DOCUMENTS_OWN) : false;
  const canViewOthers = role ? can(role, PERMISSIONS.VIEW_DOCUMENTS_OTHERS) : false;

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Documents</h1>
        <p className="text-sm text-slate-600">
          I-9, W-4, food handler permits, and other compliance paperwork. Owners and managers see
          everyone&apos;s; employees see their own.
        </p>
      </header>

      {canUpload && <UploadForm />}
      <MyDocuments />
      {canViewOthers && <TeamDocuments />}
    </div>
  );
}

function UploadForm() {
  const qc = useQueryClient();
  const [documentType, setDocumentType] = useState<DocumentType>('i9');
  const [storageUrl, setStorageUrl] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const m = useMutation({
    mutationFn: (body: { documentType: DocumentType; storageUrl?: string; expiresAt?: string }) =>
      apiClient.post('/api/v1/me/documents', body),
    onSuccess: () => {
      setStorageUrl('');
      setExpiresAt('');
      setErr(null);
      qc.invalidateQueries({ queryKey: ['me', 'documents'] });
      qc.invalidateQueries({ queryKey: ['admin', 'documents'] });
    },
    onError: (e: Error) => setErr(e.message),
  });

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-base font-semibold text-slate-900">Add a document</h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setErr(null);
          m.mutate({
            documentType,
            storageUrl: storageUrl.trim() || undefined,
            expiresAt: expiresAt || undefined,
          });
        }}
        className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-4"
      >
        <Field label="Type">
          <select
            value={documentType}
            onChange={(e) => setDocumentType(e.target.value as DocumentType)}
            className={inputClass}
          >
            {(Object.keys(DOC_LABEL) as DocumentType[]).map((t) => (
              <option key={t} value={t}>
                {DOC_LABEL[t]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Storage URL (optional)">
          <input
            type="url"
            value={storageUrl}
            onChange={(e) => setStorageUrl(e.target.value)}
            placeholder="https://drive.google.com/…"
            className={inputClass}
          />
        </Field>
        <Field label="Expires (optional)">
          <input
            type="date"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
            className={inputClass}
          />
        </Field>
        <div className="flex items-end justify-end">
          <button type="submit" disabled={m.isPending} className={btnPrimary}>
            {m.isPending ? 'Saving…' : 'Save document'}
          </button>
        </div>
        {err && <p className="md:col-span-4 text-sm text-rose-600">{err}</p>}
      </form>
      <p className="mt-3 text-xs text-slate-500">
        File hosting (S3) is wired in a follow-up — for now we store the URL of wherever you keep
        the scan (Google Drive, Dropbox, the owner&apos;s laptop).
      </p>
    </section>
  );
}

function MyDocuments() {
  const q = useQuery<MyDoc[]>({
    queryKey: ['me', 'documents'],
    queryFn: () => apiClient.get('/api/v1/me/documents'),
  });
  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <header className="border-b border-slate-100 px-5 py-3">
        <h2 className="text-base font-semibold text-slate-900">My documents</h2>
      </header>
      {q.isLoading && <p className="p-5 text-sm text-slate-500">Loading…</p>}
      {q.data?.length === 0 && (
        <p className="p-5 text-sm text-slate-500">You haven&apos;t added any documents yet.</p>
      )}
      {q.data && q.data.length > 0 && (
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-5 py-2 text-left">Type</th>
              <th className="px-5 py-2 text-left">Expires</th>
              <th className="px-5 py-2 text-left">Verified</th>
              <th className="px-5 py-2 text-left">Storage</th>
              <th className="px-5 py-2 text-left">Added</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {q.data.map((d) => (
              <tr key={d.id}>
                <td className="px-5 py-3 text-slate-800">{DOC_LABEL[d.document_type]}</td>
                <td className="px-5 py-3 text-slate-700">
                  <ExpiresPill expiresAt={d.expires_at} />
                </td>
                <td className="px-5 py-3 text-xs">
                  {d.verified_at ? (
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-800">
                      ✓ verified
                    </span>
                  ) : (
                    <span className="text-slate-400">awaiting review</span>
                  )}
                </td>
                <td className="px-5 py-3 text-xs">
                  {d.storage_url ? (
                    <a
                      href={d.storage_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-brand-700 hover:underline"
                    >
                      open ↗
                    </a>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </td>
                <td className="px-5 py-3 text-xs text-slate-500">{fmtDate(d.uploaded_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function TeamDocuments() {
  const qc = useQueryClient();
  const q = useQuery<AdminDoc[]>({
    queryKey: ['admin', 'documents'],
    queryFn: () => apiClient.get('/api/v1/admin/documents?expiringWithinDays=365'),
  });
  const verify = useMutation({
    mutationFn: (id: string) => apiClient.post(`/api/v1/admin/documents/${id}/verify`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'documents'] });
      qc.invalidateQueries({ queryKey: ['me', 'documents'] });
    },
  });

  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <header className="border-b border-slate-100 px-5 py-3">
        <h2 className="text-base font-semibold text-slate-900">Team documents</h2>
      </header>
      {q.isLoading && <p className="p-5 text-sm text-slate-500">Loading…</p>}
      {q.data?.length === 0 && <p className="p-5 text-sm text-slate-500">No team documents yet.</p>}
      {q.data && q.data.length > 0 && (
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-5 py-2 text-left">Worker</th>
              <th className="px-5 py-2 text-left">Type</th>
              <th className="px-5 py-2 text-left">Expires</th>
              <th className="px-5 py-2 text-left">Status</th>
              <th className="px-5 py-2 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {q.data.map((d) => (
              <tr key={d.id}>
                <td className="px-5 py-3">
                  <div className="font-medium text-slate-900">
                    {[d.first_name, d.last_name].filter(Boolean).join(' ') || d.email}
                  </div>
                  <div className="text-xs text-slate-500">{d.email}</div>
                </td>
                <td className="px-5 py-3 text-slate-700">{DOC_LABEL[d.document_type]}</td>
                <td className="px-5 py-3 text-slate-700">
                  <ExpiresPill expiresAt={d.expires_at} />
                </td>
                <td className="px-5 py-3 text-xs">
                  {d.verified_at ? (
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-800">
                      ✓ verified
                    </span>
                  ) : (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-800">
                      pending review
                    </span>
                  )}
                </td>
                <td className="px-5 py-3 text-right">
                  {!d.verified_at && (
                    <button
                      type="button"
                      onClick={() => verify.mutate(d.id)}
                      disabled={verify.isPending}
                      className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
                    >
                      Mark verified
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function ExpiresPill({ expiresAt }: { expiresAt: string | null }) {
  if (!expiresAt) return <span className="text-slate-400">no expiry</span>;
  const days = daysUntil(expiresAt);
  if (days < 0)
    return (
      <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-800">
        expired ({Math.abs(days)}d ago)
      </span>
    );
  if (days <= 30)
    return (
      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
        in {days}d
      </span>
    );
  return <span className="text-slate-700">in {days}d</span>;
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

function daysUntil(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number) as [number, number, number];
  const target = Date.UTC(y, m - 1, d);
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((target - today) / 86400000);
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

const inputClass =
  'mt-1 block w-full rounded-md border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100';
const btnPrimary =
  'rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 disabled:bg-slate-300';
