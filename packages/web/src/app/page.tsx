import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-brand-50 to-white p-8">
      <div className="mx-auto max-w-3xl py-24 text-center">
        <h1 className="text-5xl font-bold tracking-tight text-brand-900">PunchClock Pro</h1>
        <p className="mt-6 text-lg text-slate-700">
          Next-generation clock-in / clock-out and workforce management — offline-first,
          AI-powered, and transparently priced.
        </p>
        <div className="mt-10 flex justify-center gap-4">
          <Link
            href="/dashboard"
            className="rounded-md bg-brand-600 px-6 py-3 text-white shadow hover:bg-brand-700"
          >
            Go to dashboard
          </Link>
          <Link
            href="/dashboard/clock"
            className="rounded-md border border-brand-600 px-6 py-3 text-brand-700 hover:bg-brand-50"
          >
            Clock in / out
          </Link>
        </div>
      </div>
    </main>
  );
}
