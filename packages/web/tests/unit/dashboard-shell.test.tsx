import { describe, it, expect } from 'vitest';
import type { Role } from '@punchclock/shared';
import { visibleNavFor } from '@/app/dashboard/DashboardShell';

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
      'Trades',
    ]);
  });

  it('shows the manager superset (no Settings, no Audit log)', () => {
    const labels = labelsFor('manager');
    // Manager-only superset of employee + team-management surfaces.
    expect(labels).toContain('Overview');
    expect(labels).toContain('Clock In/Out');
    expect(labels).toContain('My Timesheet');
    expect(labels).toContain('My Schedule');
    expect(labels).toContain('Time off');
    expect(labels).toContain('Trades');
    expect(labels).toContain('Team');
    expect(labels).toContain('Schedule');
    expect(labels).toContain('Timesheets');
    expect(labels).toContain('Reports');
    // Owner-only.
    expect(labels).not.toContain('Settings');
    expect(labels).not.toContain('Audit log');
  });

  it('shows everything for the owner including Settings, Audit log, and Preview as…', () => {
    const labels = labelsFor('owner');
    for (const required of [
      'Overview',
      'Clock In/Out',
      'My Timesheet',
      'My Schedule',
      'Time off',
      'Trades',
      'Team',
      'Schedule',
      'Timesheets',
      'Reports',
      'Audit log',
      'Preview as…',
      'Settings',
    ]) {
      expect(labels).toContain(required);
    }
  });

  it('limits the viewer to read-only oversight surfaces', () => {
    expect(labelsFor('viewer')).toEqual(['Overview', 'Team', 'Schedule', 'Timesheets', 'Reports']);
  });
});
