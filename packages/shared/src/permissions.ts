/**
 * Role-based permission ledger for PunchClock Pro.
 *
 * Backed by the RBAC matrix in
 * `docs/plans/2026-05-13-mvp-v2-design.md` §5. The single source of
 * truth so the API middleware (`requirePermission`) and the web shell
 * (`<Gate>`) stay in lock-step. If a tab/action is added or moved
 * between roles, edit this file and both surfaces follow.
 *
 * Convention: action ids are `verb:noun`. Sub-resources use a dot
 * (`view:overview.cost`) so `<Gate>` lookups stay flat.
 */
import { ROLES, type Role } from './constants/index.js';

export const PERMISSIONS = {
  // Overview / dashboard.
  VIEW_OVERVIEW: 'view:overview',
  VIEW_OVERVIEW_COST: 'view:overview.cost',

  // Clock screen + own self-service surfaces.
  PUNCH_CLOCK: 'punch:clock',
  VIEW_MY_TIMESHEET: 'view:my-timesheet',
  VIEW_MY_SCHEDULE: 'view:my-schedule',

  // Time-off requests.
  VIEW_TIME_OFF: 'view:time-off',
  SUBMIT_TIME_OFF: 'submit:time-off',
  APPROVE_TIME_OFF: 'approve:time-off',

  // Shift trades.
  VIEW_TRADES: 'view:trades',
  POST_TRADE: 'post:trade',
  ACCEPT_TRADE: 'accept:trade',
  APPROVE_TRADE: 'approve:trade',

  // Team / users.
  VIEW_TEAM: 'view:team',
  INVITE_USER: 'invite:user',
  DELETE_USER: 'delete:user',

  // Schedule (all-team).
  VIEW_SCHEDULE: 'view:schedule',
  EDIT_SCHEDULE: 'edit:schedule',

  // Org-wide timesheets + reports + payroll export.
  VIEW_TIMESHEETS: 'view:timesheets',
  VIEW_REPORTS: 'view:reports',
  EXPORT_PAYROLL: 'export:payroll',

  // Settings + audit log.
  VIEW_SETTINGS: 'view:settings',
  EDIT_SETTINGS: 'edit:settings',
  VIEW_AUDIT_LOG: 'view:audit-log',

  // Documents.
  VIEW_DOCUMENTS_OWN: 'view:documents.own',
  UPLOAD_DOCUMENTS_OWN: 'upload:documents.own',
  VIEW_DOCUMENTS_OTHERS: 'view:documents.others',

  // Geofences (manager+ admin).
  EDIT_GEOFENCE: 'edit:geofence',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

/**
 * Alias used by API + web call sites — `can(role, action)` reads
 * naturally and `Action` distinguishes call-site intent from the
 * lookup constants.
 */
export type Action = Permission;

const OWNER_PERMISSIONS: ReadonlySet<Action> = new Set<Action>([
  PERMISSIONS.VIEW_OVERVIEW,
  PERMISSIONS.VIEW_OVERVIEW_COST,
  PERMISSIONS.PUNCH_CLOCK,
  PERMISSIONS.VIEW_MY_TIMESHEET,
  PERMISSIONS.VIEW_MY_SCHEDULE,
  PERMISSIONS.VIEW_TIME_OFF,
  PERMISSIONS.SUBMIT_TIME_OFF,
  PERMISSIONS.APPROVE_TIME_OFF,
  PERMISSIONS.VIEW_TRADES,
  PERMISSIONS.POST_TRADE,
  PERMISSIONS.ACCEPT_TRADE,
  PERMISSIONS.APPROVE_TRADE,
  PERMISSIONS.VIEW_TEAM,
  PERMISSIONS.INVITE_USER,
  PERMISSIONS.DELETE_USER,
  PERMISSIONS.VIEW_SCHEDULE,
  PERMISSIONS.EDIT_SCHEDULE,
  PERMISSIONS.VIEW_TIMESHEETS,
  PERMISSIONS.VIEW_REPORTS,
  PERMISSIONS.EXPORT_PAYROLL,
  PERMISSIONS.VIEW_SETTINGS,
  PERMISSIONS.EDIT_SETTINGS,
  PERMISSIONS.VIEW_AUDIT_LOG,
  PERMISSIONS.VIEW_DOCUMENTS_OWN,
  PERMISSIONS.UPLOAD_DOCUMENTS_OWN,
  PERMISSIONS.VIEW_DOCUMENTS_OTHERS,
  PERMISSIONS.EDIT_GEOFENCE,
]);

const MANAGER_PERMISSIONS: ReadonlySet<Action> = new Set<Action>([
  PERMISSIONS.VIEW_OVERVIEW,
  // No VIEW_OVERVIEW_COST — labor cost is owner-only per design §5.
  PERMISSIONS.PUNCH_CLOCK,
  PERMISSIONS.VIEW_MY_TIMESHEET,
  PERMISSIONS.VIEW_MY_SCHEDULE,
  PERMISSIONS.VIEW_TIME_OFF,
  PERMISSIONS.SUBMIT_TIME_OFF,
  PERMISSIONS.APPROVE_TIME_OFF,
  PERMISSIONS.VIEW_TRADES,
  PERMISSIONS.POST_TRADE,
  PERMISSIONS.ACCEPT_TRADE,
  PERMISSIONS.APPROVE_TRADE,
  PERMISSIONS.VIEW_TEAM,
  // Manager can invite users but only with role=employee — that
  // restriction is enforced in the API handler, not at the permission
  // gate, since the action itself is allowed.
  PERMISSIONS.INVITE_USER,
  PERMISSIONS.VIEW_SCHEDULE,
  PERMISSIONS.EDIT_SCHEDULE,
  PERMISSIONS.VIEW_TIMESHEETS,
  PERMISSIONS.VIEW_REPORTS,
  PERMISSIONS.VIEW_DOCUMENTS_OWN,
  PERMISSIONS.UPLOAD_DOCUMENTS_OWN,
  PERMISSIONS.VIEW_DOCUMENTS_OTHERS,
  PERMISSIONS.EDIT_GEOFENCE,
]);

const EMPLOYEE_PERMISSIONS: ReadonlySet<Action> = new Set<Action>([
  PERMISSIONS.PUNCH_CLOCK,
  PERMISSIONS.VIEW_MY_TIMESHEET,
  PERMISSIONS.VIEW_MY_SCHEDULE,
  PERMISSIONS.VIEW_TIME_OFF,
  PERMISSIONS.SUBMIT_TIME_OFF,
  PERMISSIONS.VIEW_TRADES,
  PERMISSIONS.POST_TRADE,
  PERMISSIONS.ACCEPT_TRADE,
  PERMISSIONS.VIEW_DOCUMENTS_OWN,
  PERMISSIONS.UPLOAD_DOCUMENTS_OWN,
]);

const VIEWER_PERMISSIONS: ReadonlySet<Action> = new Set<Action>([
  PERMISSIONS.VIEW_OVERVIEW,
  PERMISSIONS.VIEW_TEAM,
  PERMISSIONS.VIEW_SCHEDULE,
  PERMISSIONS.VIEW_TIMESHEETS,
  PERMISSIONS.VIEW_REPORTS,
]);

const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Action>> = {
  [ROLES.OWNER]: OWNER_PERMISSIONS,
  [ROLES.MANAGER]: MANAGER_PERMISSIONS,
  [ROLES.EMPLOYEE]: EMPLOYEE_PERMISSIONS,
  [ROLES.VIEWER]: VIEWER_PERMISSIONS,
};

/**
 * True when the role is allowed to perform the action. Source of
 * truth for both API middleware and the web sidebar gate.
 */
export function can(role: Role, action: Action): boolean {
  return ROLE_PERMISSIONS[role]?.has(action) ?? false;
}

/**
 * All actions the role is allowed to perform — handy for snapshotting
 * the matrix in tests or rendering an admin debug view.
 */
export function permissionsForRole(role: Role): readonly Action[] {
  return Array.from(ROLE_PERMISSIONS[role] ?? []);
}
