import type { PoolClient } from 'pg';
import {
  EVENT_TYPES,
  TIME_ENTRY_STATUS,
  type AuthenticatedUser,
  type PunchInRequestInput,
  type PunchOutRequestInput,
  type TimeEntry,
} from '@punchclock/shared';
import { AppError } from '../lib/errors.js';
import { publishTimeEvent } from '../events/publisher.js';
import { evaluateGeofence } from './geofence.service.js';
import {
  evaluateCaps,
  loadAccumulatedMinutes,
  loadOrgCapContext,
  loadUserCapContext,
  type CapWarning,
} from './caps.service.js';
import {
  closeOpenBreaks,
  evaluateMealBreak,
  loadUnpaidBreakMinutes,
  type MealBreakWarning,
} from './break.service.js';
import { AUDIT_ACTIONS, logAudit, type AuditContext } from './audit.service.js';
import {
  loadOrgVerificationConfig,
  loadUserVerificationState,
  verifyPunchCredentials,
} from './punch-verify.service.js';

interface TimeEntryRow {
  id: string;
  organization_id: string;
  user_id: string;
  punch_in_at: string;
  punch_out_at: string | null;
  punch_in_latitude: number | null;
  punch_in_longitude: number | null;
  punch_in_accuracy_m: number | null;
  punch_out_latitude: number | null;
  punch_out_longitude: number | null;
  punch_out_accuracy_m: number | null;
  punch_in_geofence_id: string | null;
  punch_out_geofence_id: string | null;
  duration_minutes: number | null;
  gross_minutes: number | null;
  unpaid_break_minutes: number;
  status: (typeof TIME_ENTRY_STATUS)[keyof typeof TIME_ENTRY_STATUS];
  notes: string | null;
  device_info: unknown;
  is_manual: boolean;
  created_at: string;
  updated_at: string;
}

function rowToTimeEntry(row: TimeEntryRow): TimeEntry {
  return {
    id: row.id,
    organizationId: row.organization_id,
    userId: row.user_id,
    punchInAt: row.punch_in_at,
    punchOutAt: row.punch_out_at,
    punchInLocation:
      row.punch_in_latitude !== null && row.punch_in_longitude !== null
        ? {
            latitude: Number(row.punch_in_latitude),
            longitude: Number(row.punch_in_longitude),
            accuracy: row.punch_in_accuracy_m ?? undefined,
          }
        : null,
    punchOutLocation:
      row.punch_out_latitude !== null && row.punch_out_longitude !== null
        ? {
            latitude: Number(row.punch_out_latitude),
            longitude: Number(row.punch_out_longitude),
            accuracy: row.punch_out_accuracy_m ?? undefined,
          }
        : null,
    punchInGeofenceId: row.punch_in_geofence_id,
    punchOutGeofenceId: row.punch_out_geofence_id,
    durationMinutes: row.duration_minutes,
    grossMinutes: row.gross_minutes,
    unpaidBreakMinutes: row.unpaid_break_minutes ?? 0,
    status: row.status,
    notes: row.notes,
    deviceInfo: row.device_info as TimeEntry['deviceInfo'],
    isManual: row.is_manual,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getCurrentOpenEntry(
  db: PoolClient,
  userId: string,
): Promise<TimeEntry | null> {
  const { rows } = await db.query<TimeEntryRow>(
    `SELECT * FROM time_entries
     WHERE user_id = $1 AND punch_out_at IS NULL AND status = 'in_progress'
     ORDER BY punch_in_at DESC LIMIT 1`,
    [userId],
  );
  return rows[0] ? rowToTimeEntry(rows[0]) : null;
}

export interface PunchInResult {
  timeEntry: TimeEntry;
  geofence: {
    inside: boolean;
    distanceMeters: number;
    geofenceId: string | null;
    enforcementLevel: string;
  };
  warnings?: CapWarning[];
}

export async function punchIn(
  db: PoolClient,
  user: AuthenticatedUser,
  input: PunchInRequestInput,
  context: { clientIp?: string | null; userAgent?: string | null } = {},
): Promise<PunchInResult> {
  // 1. Idempotency: if this clientGeneratedId has already been processed
  //    for this user, return the existing entry rather than creating a
  //    second row.
  const existingEvent = await db.query<{ time_entry_id: string | null }>(
    `SELECT time_entry_id FROM time_entry_events
     WHERE organization_id = $1 AND user_id = $2 AND client_generated_id = $3
     LIMIT 1`,
    [user.organizationId, user.userId, input.clientGeneratedId],
  );
  if (existingEvent.rows[0]?.time_entry_id) {
    const { rows } = await db.query<TimeEntryRow>('SELECT * FROM time_entries WHERE id = $1', [
      existingEvent.rows[0].time_entry_id,
    ]);
    if (rows[0]) {
      return {
        timeEntry: rowToTimeEntry(rows[0]),
        geofence: {
          inside: false,
          distanceMeters: Number.POSITIVE_INFINITY,
          geofenceId: rows[0].punch_in_geofence_id,
          enforcementLevel: 'flag',
        },
      };
    }
  }

  // 2. Refuse to open a second concurrent punch.
  const open = await getCurrentOpenEntry(db, user.userId);
  if (open) throw AppError.alreadyClockedIn();

  // 3. Evaluate geofence.
  const decision = await evaluateGeofence(db, input.location, {
    overrideProvided: !!input.overrideReason,
  });
  if (!decision.allowed) {
    throw AppError.geofenceViolation({
      reason: decision.reason,
      distanceMeters: decision.distanceMeters,
      geofenceId: decision.geofence?.id,
    });
  }

  // 3.25. Anti-buddy-punching gates (PIN / IP / etc., off by default).
  const verifyConfig = await loadOrgVerificationConfig(db);
  if (verifyConfig.enabledMethods.length > 0) {
    const verifyUser = await loadUserVerificationState(db, user.userId);
    await verifyPunchCredentials({
      config: verifyConfig,
      user: verifyUser,
      providedPin: input.pin,
      clientIp: context.clientIp ?? null,
    });
  }

  // 3.5. Hard-cap enforcement (W-2 only, opt-out via cap_exempt_until
  //      or org-level enforcement='off'). Geofence is offshore-skipped
  //      elsewhere; here we sum completed minutes today + this week.
  const [userCtx, orgCtx] = await Promise.all([
    loadUserCapContext(db, user.userId),
    loadOrgCapContext(db),
  ]);
  const accumulated = await loadAccumulatedMinutes(db, user.userId, orgCtx.timezone);
  const capDecision = evaluateCaps({
    workerType: userCtx.workerType,
    enforcement: orgCtx.enforcement,
    todayMinutes: accumulated.todayMinutes,
    weekMinutes: accumulated.weekMinutes,
    maxDailyMinutes: orgCtx.maxDailyMinutes,
    maxWeeklyMinutes: orgCtx.maxWeeklyMinutes,
    capExemptUntil: userCtx.capExemptUntil,
    now: new Date(),
  });
  if (!capDecision.allowed && capDecision.blockReason) {
    throw AppError.capExceeded(capDecision.blockReason);
  }

  // 4. Insert the materialized row.
  const { rows: inserted } = await db.query<TimeEntryRow>(
    `INSERT INTO time_entries (
        organization_id, user_id, punch_in_at,
        punch_in_latitude, punch_in_longitude, punch_in_accuracy_m,
        punch_in_geofence_id, status, device_info, notes, is_manual)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'in_progress', $8::jsonb, $9, FALSE)
     RETURNING *`,
    [
      user.organizationId,
      user.userId,
      input.timestamp,
      input.location?.latitude ?? null,
      input.location?.longitude ?? null,
      input.location?.accuracy ?? null,
      decision.geofence?.id ?? null,
      input.deviceInfo ? JSON.stringify(input.deviceInfo) : null,
      input.notes ?? null,
    ],
  );
  const row = inserted[0]!;

  // 5. Publish event (idempotency key prevents duplicates).
  await publishTimeEvent(db, {
    organizationId: user.organizationId,
    userId: user.userId,
    actorUserId: user.userId,
    eventType: EVENT_TYPES.PUNCH_IN,
    eventData: {
      location: input.location ?? null,
      geofenceId: decision.geofence?.id ?? null,
      geofenceInside: decision.inside,
      distanceMeters: Number.isFinite(decision.distanceMeters) ? decision.distanceMeters : null,
      overrideReason: input.overrideReason ?? null,
      deviceInfo: input.deviceInfo ?? null,
      notes: input.notes ?? null,
    },
    clientGeneratedId: input.clientGeneratedId,
    timeEntryId: row.id,
    recordedAt: new Date(input.timestamp),
  });

  await logAudit(db, {
    organizationId: user.organizationId,
    actorUserId: user.userId,
    resourceType: 'time_entry',
    resourceId: row.id,
    action: AUDIT_ACTIONS.PUNCH_IN,
    changes: {
      punchInAt: row.punch_in_at,
      location: input.location ?? null,
      geofenceId: decision.geofence?.id ?? null,
      geofenceInside: decision.inside,
      overrideReason: input.overrideReason ?? null,
      capWarnings: capDecision.warnings.map((w) => w.scope),
    },
    ipAddress: context.clientIp,
    userAgent: context.userAgent,
  });

  return {
    timeEntry: rowToTimeEntry(row),
    geofence: {
      inside: decision.inside,
      distanceMeters: Number.isFinite(decision.distanceMeters) ? decision.distanceMeters : -1,
      geofenceId: decision.geofence?.id ?? null,
      enforcementLevel: decision.enforcementLevel,
    },
    ...(capDecision.warnings.length > 0 ? { warnings: capDecision.warnings } : {}),
  };
}

export interface PunchOutResult {
  timeEntry: TimeEntry;
  warnings?: MealBreakWarning[];
}

export async function punchOut(
  db: PoolClient,
  user: AuthenticatedUser,
  input: PunchOutRequestInput,
  context: AuditContext = {},
): Promise<PunchOutResult> {
  // Idempotency: replay returns the existing entry.
  const existingEvent = await db.query<{ time_entry_id: string | null }>(
    `SELECT time_entry_id FROM time_entry_events
     WHERE organization_id = $1 AND user_id = $2 AND client_generated_id = $3
     LIMIT 1`,
    [user.organizationId, user.userId, input.clientGeneratedId],
  );
  if (existingEvent.rows[0]?.time_entry_id) {
    const { rows } = await db.query<TimeEntryRow>('SELECT * FROM time_entries WHERE id = $1', [
      existingEvent.rows[0].time_entry_id,
    ]);
    if (rows[0]) return { timeEntry: rowToTimeEntry(rows[0]) };
  }

  const open = await getCurrentOpenEntry(db, user.userId);
  if (!open) throw AppError.notClockedIn();

  const decision = await evaluateGeofence(db, input.location);

  // A break left running at punch-out must be closed first, or its
  // minutes never land in `breaks` and the meal period is paid by
  // accident.
  await closeOpenBreaks(db, open.id, input.timestamp);
  const unpaidBreakMinutes = await loadUnpaidBreakMinutes(db, open.id);

  const { rows: updated } = await db.query<TimeEntryRow>(
    `UPDATE time_entries
     SET punch_out_at = $2,
         punch_out_latitude = $3,
         punch_out_longitude = $4,
         punch_out_accuracy_m = $5,
         punch_out_geofence_id = $6,
         gross_minutes = GREATEST(0,
           EXTRACT(EPOCH FROM ($2::timestamptz - punch_in_at))::int / 60),
         unpaid_break_minutes = $8,
         -- Payable time is wall-clock less unpaid breaks. Every
         -- downstream consumer (timesheets, payroll export) sums
         -- duration_minutes, so the deduction has to happen here.
         duration_minutes = GREATEST(0,
           EXTRACT(EPOCH FROM ($2::timestamptz - punch_in_at))::int / 60 - $8),
         status = 'completed',
         notes = COALESCE($7, notes),
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [
      open.id,
      input.timestamp,
      input.location?.latitude ?? null,
      input.location?.longitude ?? null,
      input.location?.accuracy ?? null,
      decision.geofence?.id ?? null,
      input.notes ?? null,
      unpaidBreakMinutes,
    ],
  );
  const row = updated[0]!;

  await publishTimeEvent(db, {
    organizationId: user.organizationId,
    userId: user.userId,
    actorUserId: user.userId,
    eventType: EVENT_TYPES.PUNCH_OUT,
    eventData: {
      location: input.location ?? null,
      geofenceId: decision.geofence?.id ?? null,
      deviceInfo: input.deviceInfo ?? null,
      notes: input.notes ?? null,
    },
    clientGeneratedId: input.clientGeneratedId,
    timeEntryId: row.id,
    recordedAt: new Date(input.timestamp),
  });

  // Meal-break compliance check. Soft warnings only — never blocks
  // the punch-out, because trapping a worker on the clock would be
  // worse than the violation itself.
  const [orgRow, userRow] = await Promise.all([
    db.query<{ timezone: string }>(`SELECT timezone FROM organizations LIMIT 1`),
    db.query<{ worksite: 'onshore' | 'offshore' }>(`SELECT worksite FROM users WHERE id = $1`, [
      user.userId,
    ]),
  ]);
  const mealEval = evaluateMealBreak({
    // Entitlement is driven by how long the shift ran, not by what we
    // ended up paying — so this is gross, before the break deduction.
    shiftMinutes: row.gross_minutes ?? 0,
    mealBreakMinutes: unpaidBreakMinutes,
    worksite: userRow.rows[0]?.worksite ?? 'onshore',
    orgTimezone: orgRow.rows[0]?.timezone ?? 'UTC',
  });

  await logAudit(db, {
    organizationId: user.organizationId,
    actorUserId: user.userId,
    resourceType: 'time_entry',
    resourceId: row.id,
    action: AUDIT_ACTIONS.PUNCH_OUT,
    changes: {
      punchOutAt: row.punch_out_at,
      grossMinutes: row.gross_minutes,
      unpaidBreakMinutes: row.unpaid_break_minutes,
      durationMinutes: row.duration_minutes,
      location: input.location ?? null,
      mealBreakWarnings: mealEval.warnings.map((w) => w.code),
    },
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
  });

  return {
    timeEntry: rowToTimeEntry(row),
    ...(mealEval.warnings.length > 0 ? { warnings: mealEval.warnings } : {}),
  };
}

export async function listEntries(
  db: PoolClient,
  user: AuthenticatedUser,
  opts: {
    userId?: string;
    fromDate?: string;
    toDate?: string;
    limit?: number;
    includeDeleted?: boolean;
  } = {},
): Promise<TimeEntry[]> {
  // Guard against NaN/negative/oversized limits reaching the SQL string.
  const requested = Number(opts.limit);
  const limit =
    Number.isFinite(requested) && requested > 0 ? Math.min(Math.floor(requested), 500) : 100;
  const conditions: string[] = [];
  const params: unknown[] = [];

  // Removed entries are soft-deleted so the audit trail survives, but
  // they are not part of anyone's timesheet — leaving them in meant a
  // deleted punch still showed in the worker's list, and acting on it
  // failed with a confusing error.
  if (!opts.includeDeleted) {
    conditions.push(`status <> 'deleted'`);
  }

  // Employees are confined to their own entries — an explicit `userId`
  // for anyone else is refused rather than silently widened. Without
  // this, `?userId=<coworker>` returned another worker's punches and
  // GPS coordinates (RLS only scopes to the organization, not the user).
  if (user.role === 'employee' && opts.userId && opts.userId !== user.userId) {
    throw AppError.forbidden('You can only view your own time entries');
  }

  const scopedUserId = user.role === 'employee' ? user.userId : opts.userId;
  if (scopedUserId) {
    params.push(scopedUserId);
    conditions.push(`user_id = $${params.length}`);
  }

  if (opts.fromDate) {
    params.push(opts.fromDate);
    conditions.push(`punch_in_at >= $${params.length}`);
  }
  if (opts.toDate) {
    params.push(opts.toDate);
    conditions.push(`punch_in_at <= $${params.length}`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const sql = `SELECT * FROM time_entries ${where} ORDER BY punch_in_at DESC LIMIT ${limit}`;
  const { rows } = await db.query<TimeEntryRow>(sql, params);
  return rows.map(rowToTimeEntry);
}
