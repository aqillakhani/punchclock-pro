import { describe, it, expect } from 'vitest';
import type { Role } from '@punchclock/shared';
import { canOpenPath, visibleNavFor } from '@/app/dashboard/DashboardShell';

/**
 * Phase A acceptance gate (sidebar half) lives here. We assert the
 * exact label set rendered for each role — render-tree mocking would
 * pin us to internals, but the nav filter is pure, so we test it
 * directly through the exported `visibleNavFor()` helper.
 */
function labelsFor(role: Role | undefined): string[] {
  return visibleNavFor(role).map((item) => item.label);
}

describe('DashboardShell sidebar gating', () => {
  it('renders no tabs while the role is still loading', () => {
    expect(labelsFor(undefined)).toEqual([]);
  });

  it('shows the employee self-service set only', () => {
    expect(labelsFor('employee')).toEqual([
      'Clock In/Out',
      'My Timesheet',
      'My Schedule',
      'Time off',
      'Corrections',
      'Trades',
      'Documents',
    ]);
  });

  it('shows the manager superset (no Settings, no Audit log, no Preview as)', () => {
    const labels = labelsFor('manager');
    // Manager-only superset of employee + team-management surfaces.
    expect(labels).toContain('Overview');
    expect(labels).toContain('Clock In/Out');
    expect(labels).toContain('My Timesheet');
    expect(labels).toContain('My Schedule');
    expect(labels).toContain('Time off');
    expect(labels).toContain('Corrections');
    expect(labels).toContain('Trades');
    expect(labels).toContain('Documents');
    expect(labels).toContain('Team');
    expect(labels).toContain('Schedule');
    expect(labels).toContain('Timesheets');
    expect(labels).toContain('Pay periods');
    expect(labels).toContain('Reports');
    // Owner-only.
    expect(labels).not.toContain('Settings');
    expect(labels).not.toContain('Audit log');
    expect(labels).not.toContain('Preview as…');
  });

  it('shows everything for the owner including Settings, Audit log, and Preview as…', () => {
    const labels = labelsFor('owner');
    for (const required of [
      'Overview',
      'Clock In/Out',
      'My Timesheet',
      'My Schedule',
      'Time off',
      'Corrections',
      'Trades',
      'Documents',
      'Team',
      'Schedule',
      'Timesheets',
      'Pay periods',
      'Reports',
      'Audit log',
      'Preview as…',
      'Settings',
    ]) {
      expect(labels).toContain(required);
    }
  });

  it('limits the viewer to read-only oversight surfaces', () => {
    expect(labelsFor('viewer')).toEqual([
      'Overview',
      'Team',
      'Schedule',
      'Timesheets',
      'Pay periods',
      'Reports',
    ]);
  });
});

/**
 * Hiding a sidebar tab is not access control. An employee who typed
 * /dashboard/settings straight into the address bar still got the settings
 * shell rendered (the API refused the data, so it looked like a broken page).
 * `canOpenPath` is what the shell now consults before rendering a page.
 */
describe('canOpenPath', () => {
  it('lets an owner open the owner-only pages', () => {
    expect(canOpenPath('owner', '/dashboard/settings')).toBe(true);
    expect(canOpenPath('owner', '/dashboard/audit-log')).toBe(true);
    expect(canOpenPath('owner', '/dashboard/reports')).toBe(true);
  });

  it('blocks an employee from owner-only pages', () => {
    expect(canOpenPath('employee', '/dashboard/settings')).toBe(false);
    expect(canOpenPath('employee', '/dashboard/audit-log')).toBe(false);
    expect(canOpenPath('employee', '/dashboard/team')).toBe(false);
    expect(canOpenPath('employee', '/dashboard/reports')).toBe(false);
  });

  it('still lets an employee open their own pages', () => {
    expect(canOpenPath('employee', '/dashboard/clock')).toBe(true);
    expect(canOpenPath('employee', '/dashboard/my-timesheet')).toBe(true);
    expect(canOpenPath('employee', '/dashboard/time-off')).toBe(true);
  });

  it('blocks a viewer from the clock, which they may not use', () => {
    expect(canOpenPath('viewer', '/dashboard/clock')).toBe(false);
    expect(canOpenPath('viewer', '/dashboard/timesheets')).toBe(true);
  });

  it('matches the longest prefix, so a sub-path is not granted by /dashboard', () => {
    // '/dashboard' requires only view:overview; without longest-prefix matching
    // an employee would inherit access to every /dashboard/* page.
    expect(canOpenPath('employee', '/dashboard/settings')).toBe(false);
  });

  it('allows an unlisted path rather than silently blocking a new page', () => {
    expect(canOpenPath('employee', '/dashboard/something-new')).toBe(true);
  });

  it('denies everything when the role is unknown', () => {
    expect(canOpenPath(undefined, '/dashboard/clock')).toBe(false);
  });
});
