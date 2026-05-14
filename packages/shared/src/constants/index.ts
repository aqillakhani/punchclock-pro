export const ROLES = {
  OWNER: 'owner',
  MANAGER: 'manager',
  EMPLOYEE: 'employee',
  VIEWER: 'viewer',
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

export const ROLE_HIERARCHY: Record<Role, number> = {
  owner: 4,
  manager: 3,
  employee: 2,
  viewer: 1,
};

export const EVENT_TYPES = {
  PUNCH_IN: 'punch_in',
  PUNCH_OUT: 'punch_out',
  BREAK_START: 'break_start',
  BREAK_END: 'break_end',
  ENTRY_EDITED: 'entry_edited',
  ENTRY_DELETED: 'entry_deleted',
  JOB_SWITCHED: 'job_switched',
} as const;

export type EventType = (typeof EVENT_TYPES)[keyof typeof EVENT_TYPES];

export const GEOFENCE_ENFORCEMENT = {
  FLAG: 'flag',
  OVERRIDE_REQUIRED: 'override_required',
  BLOCK: 'block',
} as const;

export type GeofenceEnforcement = (typeof GEOFENCE_ENFORCEMENT)[keyof typeof GEOFENCE_ENFORCEMENT];

export const BREAK_TYPES = {
  LUNCH: 'lunch',
  STANDARD: 'standard',
  UNPAID: 'unpaid',
} as const;

export type BreakType = (typeof BREAK_TYPES)[keyof typeof BREAK_TYPES];

export const TIME_ENTRY_STATUS = {
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  EDITED: 'edited',
  DELETED: 'deleted',
} as const;

export type TimeEntryStatus = (typeof TIME_ENTRY_STATUS)[keyof typeof TIME_ENTRY_STATUS];

export const OVERTIME_RULES = {
  FEDERAL_WEEKLY_THRESHOLD: 40,
  FEDERAL_OT_MULTIPLIER: 1.5,
  CA_DAILY_OT_THRESHOLD: 8,
  CA_DAILY_DOUBLE_THRESHOLD: 12,
  CA_WEEKLY_OT_THRESHOLD: 40,
  CA_SEVENTH_DAY_OT: true,
} as const;

export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE_ENTITY: 422,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_ERROR: 500,
} as const;

export const ERROR_CODES = {
  VALIDATION: 'VALIDATION_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  ALREADY_CLOCKED_IN: 'ALREADY_CLOCKED_IN',
  NOT_CLOCKED_IN: 'NOT_CLOCKED_IN',
  GEOFENCE_VIOLATION: 'GEOFENCE_VIOLATION',
  CAP_EXCEEDED: 'CAP_EXCEEDED',
  INTERNAL: 'INTERNAL_ERROR',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
