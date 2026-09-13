/**
 * Route-level authorization guards.
 *
 * Every case here corresponds to a hole found by auditing the live production
 * API with real tokens on 2026-09-13. They were all reachable by a role the
 * permission matrix does not grant:
 *
 *   - a read-only `viewer` could punch in and create payroll hours, both
 *     directly and through the mobile sync batch endpoint
 *   - an `employee` could read any coworker's shifts via `?userId=`
 *   - an `employee` could read every coworker's punches, GPS and breaks
 *     through /sync/changes, which bypassed the check /time-tracking/entries
 *     already enforced
 *   - any authenticated user could read org settings and exact store geofence
 *     coordinates
 *
 * These assert the route table itself, so a future refactor that drops a guard
 * fails here rather than in production.
 */
import { PERMISSIONS, ROLES, can } from '@punchclock/shared';
import { adminRouter } from '../../src/routes/admin.js';
import { geofenceRouter } from '../../src/routes/geofence.js';
import { schedulingRouter } from '../../src/routes/scheduling.js';
import { syncRouter } from '../../src/routes/sync.js';
import { timeTrackingRouter } from '../../src/routes/time-tracking.js';

type Layer = {
  route?: {
    path: string;
    stack: { handle: { requiredPermission?: string } }[];
    methods: Record<string, boolean>;
  };
};

/** The permission a route enforces, or null when it enforces none. */
function permissionFor(router: { stack: Layer[] }, method: string, path: string): string | null {
  const layer = router.stack.find(
    (l) => l.route?.path === path && l.route?.methods[method.toLowerCase()],
  );
  if (!layer?.route) throw new Error(`route not found: ${method} ${path}`);
  for (const s of layer.route.stack) {
    if (s.handle?.requiredPermission) return s.handle.requiredPermission;
  }
  return null;
}

describe('punch endpoints require punch:clock', () => {
  // A `viewer` is read-only. Before this guard existed, POST /punch-in
  // returned 201 for a viewer and created a real time entry.
  it.each([
    ['post', '/punch-in'],
    ['post', '/punch-out'],
    ['post', '/breaks'],
    ['post', '/breaks/:id/end'],
  ])('%s %s enforces punch:clock', (method, path) => {
    expect(permissionFor(timeTrackingRouter, method, path)).toBe(PERMISSIONS.PUNCH_CLOCK);
  });

  it('viewer does not hold punch:clock, so the guard actually excludes them', () => {
    expect(can(ROLES.VIEWER, PERMISSIONS.PUNCH_CLOCK)).toBe(false);
    expect(can(ROLES.EMPLOYEE, PERMISSIONS.PUNCH_CLOCK)).toBe(true);
    expect(can(ROLES.MANAGER, PERMISSIONS.PUNCH_CLOCK)).toBe(true);
    expect(can(ROLES.OWNER, PERMISSIONS.PUNCH_CLOCK)).toBe(true);
  });
});

describe('sync endpoints are not a way around the punch guards', () => {
  // POST /sync/batch replays punch_in/punch_out. A viewer used it to punch in
  // successfully even after /time-tracking/punch-in had been locked down.
  it('POST /batch enforces punch:clock', () => {
    expect(permissionFor(syncRouter, 'post', '/batch')).toBe(PERMISSIONS.PUNCH_CLOCK);
  });
});

describe('organization + geofence reads are permission-guarded', () => {
  it('GET /team-status enforces view:overview', () => {
    expect(permissionFor(adminRouter, 'get', '/team-status')).toBe(PERMISSIONS.VIEW_OVERVIEW);
  });

  it('GET /cost-of-labor enforces the owner-only cost permission', () => {
    expect(permissionFor(adminRouter, 'get', '/cost-of-labor')).toBe(
      PERMISSIONS.VIEW_OVERVIEW_COST,
    );
    expect(can(ROLES.MANAGER, PERMISSIONS.VIEW_OVERVIEW_COST)).toBe(false);
  });

  it('GET /geofence list is guarded — exact store coordinates are not worker-facing', () => {
    expect(permissionFor(geofenceRouter, 'get', '/')).toBe(PERMISSIONS.EDIT_GEOFENCE);
    expect(can(ROLES.EMPLOYEE, PERMISSIONS.EDIT_GEOFENCE)).toBe(false);
    expect(can(ROLES.VIEWER, PERMISSIONS.EDIT_GEOFENCE)).toBe(false);
  });

  it('GET /organization stays open but only owners hold view:settings', () => {
    // Deliberately NOT permission-guarded: the Clock In/Out screen reads
    // punch_verification_methods + feature_cash_drawer off it, so gating the
    // route would stop every worker punching in. The handler trims the payload
    // instead — see ORGANIZATION_PUBLIC_FIELDS in routes/admin.ts.
    expect(permissionFor(adminRouter, 'get', '/organization')).toBeNull();
    expect(can(ROLES.OWNER, PERMISSIONS.VIEW_SETTINGS)).toBe(true);
    expect(can(ROLES.MANAGER, PERMISSIONS.VIEW_SETTINGS)).toBe(false);
    expect(can(ROLES.EMPLOYEE, PERMISSIONS.VIEW_SETTINGS)).toBe(false);
    expect(can(ROLES.VIEWER, PERMISSIONS.VIEW_SETTINGS)).toBe(false);
  });
});

describe('schedule reads respect view:schedule', () => {
  // GET /shifts?userId=<coworker> returned that coworker's whole schedule to an
  // employee: the `?userId=` branch ran before the employee self-scoping.
  it('employees cannot hold view:schedule', () => {
    expect(can(ROLES.EMPLOYEE, PERMISSIONS.VIEW_SCHEDULE)).toBe(false);
    expect(can(ROLES.EMPLOYEE, PERMISSIONS.VIEW_MY_SCHEDULE)).toBe(true);
    expect(can(ROLES.MANAGER, PERMISSIONS.VIEW_SCHEDULE)).toBe(true);
    expect(can(ROLES.VIEWER, PERMISSIONS.VIEW_SCHEDULE)).toBe(true);
  });

  it('GET /shifts is reachable without a blanket guard (self-scoped in the handler)', () => {
    // Employees legitimately read their OWN shifts here, so the route carries no
    // requirePermission; the handler rejects a `?userId=` pointing at anyone else.
    expect(permissionFor(schedulingRouter, 'get', '/shifts')).toBeNull();
  });
});

describe('the permission matrix itself', () => {
  it('viewer is strictly read-only — holds no write permission', () => {
    const writes = [
      PERMISSIONS.PUNCH_CLOCK,
      PERMISSIONS.EDIT_SCHEDULE,
      PERMISSIONS.EDIT_SETTINGS,
      PERMISSIONS.EDIT_GEOFENCE,
      PERMISSIONS.INVITE_USER,
      PERMISSIONS.DELETE_USER,
    ];
    for (const w of writes) {
      expect([w, can(ROLES.VIEWER, w)]).toEqual([w, false]);
    }
  });
});
