import { describe, it, expect } from '@jest/globals';
import {
  PERMISSIONS,
  ROLES,
  can,
  permissionsForRole,
  type Action,
  type Role,
} from '@punchclock/shared';

/**
 * Source of truth for the test: the matrix from
 * docs/plans/2026-05-13-mvp-v2-design.md §5. Each cell is a
 * boolean — true means the role MUST be allowed, false means it
 * MUST be blocked. The product of (roles × actions) drives every
 * assertion below, so adding a permission to the production set
 * without updating this matrix will fail loudly.
 */
const EXPECTED_MATRIX: Record<Action, Record<Role, boolean>> = {
  [PERMISSIONS.VIEW_OVERVIEW]: { owner: true, manager: true, employee: false, viewer: true },
  [PERMISSIONS.VIEW_OVERVIEW_COST]: {
    owner: true,
    manager: false,
    employee: false,
    viewer: false,
  },
  [PERMISSIONS.PUNCH_CLOCK]: { owner: true, manager: true, employee: true, viewer: false },
  [PERMISSIONS.VIEW_MY_TIMESHEET]: {
    owner: true,
    manager: true,
    employee: true,
    viewer: false,
  },
  [PERMISSIONS.VIEW_MY_SCHEDULE]: { owner: true, manager: true, employee: true, viewer: false },
  [PERMISSIONS.VIEW_TIME_OFF]: { owner: true, manager: true, employee: true, viewer: false },
  [PERMISSIONS.SUBMIT_TIME_OFF]: { owner: true, manager: true, employee: true, viewer: false },
  [PERMISSIONS.APPROVE_TIME_OFF]: {
    owner: true,
    manager: true,
    employee: false,
    viewer: false,
  },
  [PERMISSIONS.VIEW_TRADES]: { owner: true, manager: true, employee: true, viewer: false },
  [PERMISSIONS.POST_TRADE]: { owner: true, manager: true, employee: true, viewer: false },
  [PERMISSIONS.ACCEPT_TRADE]: { owner: true, manager: true, employee: true, viewer: false },
  [PERMISSIONS.APPROVE_TRADE]: { owner: true, manager: true, employee: false, viewer: false },
  [PERMISSIONS.VIEW_TEAM]: { owner: true, manager: true, employee: false, viewer: true },
  [PERMISSIONS.INVITE_USER]: { owner: true, manager: true, employee: false, viewer: false },
  [PERMISSIONS.DELETE_USER]: { owner: true, manager: false, employee: false, viewer: false },
  [PERMISSIONS.VIEW_SCHEDULE]: { owner: true, manager: true, employee: false, viewer: true },
  [PERMISSIONS.EDIT_SCHEDULE]: { owner: true, manager: true, employee: false, viewer: false },
  [PERMISSIONS.VIEW_TIMESHEETS]: { owner: true, manager: true, employee: false, viewer: true },
  [PERMISSIONS.VIEW_REPORTS]: { owner: true, manager: true, employee: false, viewer: true },
  [PERMISSIONS.EXPORT_PAYROLL]: { owner: true, manager: false, employee: false, viewer: false },
  [PERMISSIONS.VIEW_SETTINGS]: { owner: true, manager: false, employee: false, viewer: false },
  [PERMISSIONS.EDIT_SETTINGS]: { owner: true, manager: false, employee: false, viewer: false },
  [PERMISSIONS.VIEW_AUDIT_LOG]: { owner: true, manager: false, employee: false, viewer: false },
  [PERMISSIONS.VIEW_DOCUMENTS_OWN]: {
    owner: true,
    manager: true,
    employee: true,
    viewer: false,
  },
  [PERMISSIONS.UPLOAD_DOCUMENTS_OWN]: {
    owner: true,
    manager: true,
    employee: true,
    viewer: false,
  },
  [PERMISSIONS.VIEW_DOCUMENTS_OTHERS]: {
    owner: true,
    manager: true,
    employee: false,
    viewer: false,
  },
  [PERMISSIONS.EDIT_GEOFENCE]: { owner: true, manager: true, employee: false, viewer: false },
  [PERMISSIONS.PREVIEW_AS_USER]: { owner: true, manager: false, employee: false, viewer: false },
};

const ALL_ROLES: readonly Role[] = [ROLES.OWNER, ROLES.MANAGER, ROLES.EMPLOYEE, ROLES.VIEWER];
const ALL_ACTIONS = Object.values(PERMISSIONS) as readonly Action[];

describe('permissions matrix', () => {
  it('covers every action declared in PERMISSIONS', () => {
    const matrixActions = new Set(Object.keys(EXPECTED_MATRIX));
    for (const action of ALL_ACTIONS) {
      expect(matrixActions.has(action)).toBe(true);
    }
    expect(matrixActions.size).toBe(ALL_ACTIONS.length);
  });

  for (const action of ALL_ACTIONS) {
    describe(`action ${action}`, () => {
      for (const role of ALL_ROLES) {
        const expected = EXPECTED_MATRIX[action][role];
        it(`${role} ${expected ? 'CAN' : 'CANNOT'}`, () => {
          expect(can(role, action)).toBe(expected);
        });
      }
    });
  }
});

describe('can()', () => {
  it('returns false for unknown actions even on owner', () => {
    expect(can(ROLES.OWNER, 'phantom:action' as Action)).toBe(false);
  });

  it('returns false for an unknown role', () => {
    expect(can('superuser' as unknown as Role, PERMISSIONS.PUNCH_CLOCK)).toBe(false);
  });
});

describe('permissionsForRole()', () => {
  it('returns the exact set the owner is allowed', () => {
    const ownerActions = new Set(permissionsForRole(ROLES.OWNER));
    for (const action of ALL_ACTIONS) {
      expect(ownerActions.has(action)).toBe(EXPECTED_MATRIX[action].owner);
    }
  });

  it('matches can() for every role × action pair', () => {
    for (const role of ALL_ROLES) {
      const allowed = new Set(permissionsForRole(role));
      for (const action of ALL_ACTIONS) {
        expect(allowed.has(action)).toBe(can(role, action));
      }
    }
  });

  it('returns an empty list for an unknown role', () => {
    expect(permissionsForRole('superuser' as unknown as Role)).toEqual([]);
  });
});
