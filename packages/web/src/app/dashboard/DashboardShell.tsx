'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { clearToken } from '@/lib/auth';

interface Me {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  role: 'owner' | 'manager' | 'employee' | 'viewer';
  organization_id: string;
  organization_name: string;
}

interface NavItem {
  href: string;
  label: string;
  icon: string;
}

const NAV: NavItem[] = [
  { href: '/dashboard', label: 'Overview', icon: '⌂' },
  { href: '/dashboard/clock', label: 'Clock In/Out', icon: '⏱' },
  { href: '/dashboard/team', label: 'Team', icon: '◉' },
  { href: '/dashboard/schedule', label: 'Schedule', icon: '▦' },
  { href: '/dashboard/timesheets', label: 'Timesheets', icon: '☷' },
  { href: '/dashboard/reports', label: 'Reports', icon: '◔' },
  { href: '/dashboard/settings', label: 'Settings', icon: '✦' },
];

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  const me = useQuery<Me>({
    queryKey: ['auth', 'me'],
    queryFn: () => apiClient.get('/auth/me'),
    staleTime: 5 * 60 * 1000,
  });

  function signOut() {
    clearToken();
    router.replace('/login');
  }

  return (
    <div className="flex min-h-screen bg-slate-50">
      <aside className="flex w-60 flex-col border-r border-slate-200 bg-white">
        <div className="border-b border-slate-100 p-5">
          <div className="text-xs uppercase tracking-wide text-slate-400">PunchClock</div>
          <div className="mt-0.5 truncate text-base font-semibold text-slate-900">
            {me.data?.organization_name ?? '…'}
          </div>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 p-3">
          {NAV.map((item) => {
            const active =
              item.href === '/dashboard'
                ? pathname === '/dashboard'
                : pathname?.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={[
                  'flex items-center gap-2 rounded-md px-3 py-2 text-sm',
                  active
                    ? 'bg-brand-50 font-medium text-brand-700'
                    : 'text-slate-700 hover:bg-slate-50',
                ].join(' ')}
              >
                <span className="text-base leading-none text-slate-400">{item.icon}</span>
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-slate-100 p-3">
          <div className="rounded-md p-2">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-100 text-sm font-medium text-brand-700">
                {initials(me.data)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-slate-900">
                  {displayName(me.data) ?? '…'}
                </div>
                <div className="truncate text-xs capitalize text-slate-500">
                  {me.data?.role ?? ''}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={signOut}
              className="mt-2 w-full rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:border-slate-300 hover:bg-slate-50"
            >
              Sign out
            </button>
          </div>
        </div>
      </aside>
      <main className="flex-1 p-8">{children}</main>
    </div>
  );
}

function displayName(me: Me | undefined): string | null {
  if (!me) return null;
  const name = [me.first_name, me.last_name].filter(Boolean).join(' ').trim();
  return name || me.email;
}

function initials(me: Me | undefined): string {
  if (!me) return '…';
  const f = me.first_name?.[0] ?? me.email[0] ?? '?';
  const l = me.last_name?.[0] ?? '';
  return `${f}${l}`.toUpperCase();
}
