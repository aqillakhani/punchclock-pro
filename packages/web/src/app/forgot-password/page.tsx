'use client';

import Link from 'next/link';
import { useState } from 'react';
import { apiClient } from '@/lib/api-client';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiClient.post('/auth/forgot-password', { email });
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-brand-50 to-white p-6">
      <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="mb-1 text-2xl font-bold text-brand-900">Reset your password</h1>
        <p className="mb-6 text-sm text-slate-600">
          We&apos;ll email you a link to choose a new password.
        </p>
        {sent ? (
          <div className="space-y-4">
            <div className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
              If that email is registered, a reset link is on its way. Check your inbox — the link
              expires in 15 minutes.
            </div>
            <Link
              href="/login"
              className="block text-center text-sm text-brand-700 hover:underline"
            >
              Back to sign in
            </Link>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-700">Email</span>
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
              />
            </label>
            {error && (
              <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
            )}
            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-md bg-brand-600 px-4 py-2 font-medium text-white shadow-sm hover:bg-brand-700 disabled:opacity-60"
            >
              {submitting ? 'Sending…' : 'Send reset link'}
            </button>
            <Link
              href="/login"
              className="block text-center text-xs text-slate-500 hover:text-slate-700 hover:underline"
            >
              Back to sign in
            </Link>
          </form>
        )}
      </div>
    </main>
  );
}
