import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { LogoutButton } from './LogoutButton';

const NAV: Array<{ href: string; label: string }> = [
  { href: '/dashboard', label: 'Overview' },
  { href: '/dashboard/clock', label: 'Clock In/Out' },
  { href: '/dashboard/team', label: 'Team' },
  { href: '/dashboard/schedule', label: 'Schedule' },
  { href: '/dashboard/reports', label: 'Reports' },
  { href: '/dashboard/settings', label: 'Settings' },
];

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const token = (await cookies()).get('pc_token')?.value;
  if (!token) redirect('/login');

  return (
    <div className="flex min-h-screen bg-slate-50">
      <aside className="flex w-60 flex-col border-r border-slate-200 bg-white p-6">
        <div className="mb-10 text-xl font-bold text-brand-700">PunchClock</div>
        <nav className="flex flex-col gap-1">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-md px-3 py-2 text-slate-700 hover:bg-brand-50 hover:text-brand-700"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto pt-6">
          <LogoutButton />
        </div>
      </aside>
      <main className="flex-1 p-8">{children}</main>
    </div>
  );
}
