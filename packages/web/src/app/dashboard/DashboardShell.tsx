'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PERMISSIONS, can, type Action, type Role } from '@punchclock/shared';
import { apiClient, getPreviewAsUserId, setPreviewAsUserId } from '@/lib/api-client';
import { clearToken } from '@/lib/auth';

interface Me {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  role: Role;
  organization_id: string;
  organization_name: string;
}

interface NavItem {
  href: string;
  label: string;
  icon: string;
  requires: Action;
}

/**
 * Sidebar entries. Each item declares the permission it needs;
 * `DashboardShell` filters this list through `can(role, requires)`
 * so the menu always reflects the shared RBAC matrix.
 *
 * Order is the reading order — owner-only items live at the bottom.
 */
const NAV: NavItem[] = [
  { href: '/dashboard', label: 'Overview', icon: '⌂', requires: PERMISSIONS.VIEW_OVERVIEW },
  { href: '/dashboard/clock', label: 'Clock In/Out', icon: '⏱', requires: PERMISSIONS.PUNCH_CLOCK },
  {
    href: '/dashboard/my-timesheet',
    label: 'My Timesheet',
    icon: '☱',
    requires: PERMISSIONS.VIEW_MY_TIMESHEET,
  },
  {
    href: '/dashboard/my-schedule',
    label: 'My Schedule',
    icon: '☰',
    requires: PERMISSIONS.VIEW_MY_SCHEDULE,
  },
  {
    href: '/dashboard/time-off',
    label: 'Time off',
    icon: '✈',
    requires: PERMISSIONS.VIEW_TIME_OFF,
  },
  { href: '/dashboard/trades', label: 'Trades', icon: '⇄', requires: PERMISSIONS.VIEW_TRADES },
  {
    href: '/dashboard/documents',
    label: 'Documents',
    icon: '📄',
    requires: PERMISSIONS.VIEW_DOCUMENTS_OWN,
  },
  { href: '/dashboard/team', label: 'Team', icon: '◉', requires: PERMISSIONS.VIEW_TEAM },
  {
    href: '/dashboard/schedule',
    label: 'Schedule',
    icon: '▦',
    requires: PERMISSIONS.VIEW_SCHEDULE,
  },
  {
    href: '/dashboard/timesheets',
    label: 'Timesheets',
    icon: '☷',
    requires: PERMISSIONS.VIEW_TIMESHEETS,
  },
  { href: '/dashboard/reports', label: 'Reports', icon: '◔', requires: PERMISSIONS.VIEW_REPORTS },
  {
    href: '/dashboard/audit-log',
    label: 'Audit log',
    icon: '☶',
    requires: PERMISSIONS.VIEW_AUDIT_LOG,
  },
  {
    href: '/dashboard/preview-as',
    label: 'Preview as…',
    icon: '◐',
    requires: PERMISSIONS.PREVIEW_AS_USER,
  },
  {
    href: '/dashboard/settings',
    label: 'Settings',
    icon: '✦',
    requires: PERMISSIONS.VIEW_SETTINGS,
  },
];

export function visibleNavFor(role: Role | undefined): NavItem[] {
  if (!role) return [];
  return NAV.filter((item) => can(role, item.requires));
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const qc = useQueryClient();

  const me = useQuery<Me>({
    queryKey: ['auth', 'me'],
    queryFn: () => apiClient.get('/auth/me'),
    staleTime: 5 * 60 * 1000,
  });

  // Render the preview banner when the owner has flipped on "preview
  // as worker". The header is sent on every request automatically by
  // api-client; we just need to keep state for the banner UI.
  const [previewing, setPreviewing] = useState<string | null>(null);
  useEffect(() => {
    setPreviewing(getPreviewAsUserId());
  }, [me.data?.id]);

  function exitPreview() {
    setPreviewAsUserId(null);
    setPreviewing(null);
    qc.invalidateQueries();
    router.push('/dashboard');
  }

  function signOut() {
    clearToken();
    setPreviewAsUserId(null);
    router.replace('/login');
  }

  const visibleNav = visibleNavFor(me.data?.role);

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
          {visibleNav.length === 0 ? (
            <div className="rounded-md border border-dashed border-slate-200 p-3 text-xs text-slate-500">
              {me.data
                ? 'Your account has no enabled tabs. Ask an owner to update your role.'
                : 'Loading…'}
            </div>
          ) : (
            visibleNav.map((item) => {
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
            })
          )}
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
      <main className="flex-1">
        {previewing && me.data && (
          <div className="sticky top-0 z-20 flex items-center justify-between border-b border-amber-300 bg-amber-100 px-6 py-2 text-sm text-amber-900">
            <span>
              <span className="font-medium">
                Previewing as {displayName(me.data) ?? me.data.email}
              </span>{' '}
              <span className="text-amber-800">({me.data.role})</span> — your real owner session is
              still in place.
            </span>
            <button
              type="button"
              onClick={exitPreview}
              className="rounded-md bg-amber-200 px-3 py-1 text-xs font-semibold text-amber-900 hover:bg-amber-300"
            >
              Exit preview
            </button>
          </div>
        )}
        <div className="p-8">{children}</div>
      </main>
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
