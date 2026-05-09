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
}

export async function punchIn(
  db: PoolClient,
  user: AuthenticatedUser,
  input: PunchInRequestInput,
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
    const { rows } = await db.query<TimeEntryRow>(
      'SELECT * FROM time_entries WHERE id = $1',
      [existingEvent.rows[0].time_entry_id],
    );
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

  return {
    timeEntry: rowToTimeEntry(row),
    geofence: {
      inside: decision.inside,
      distanceMeters: Number.isFinite(decision.distanceMeters) ? decision.distanceMeters : -1,
      geofenceId: decision.geofence?.id ?? null,
      enforcementLevel: decision.enforcementLevel,
    },
  };
}

export async function punchOut(
  db: PoolClient,
  user: AuthenticatedUser,
  input: PunchOutRequestInput,
): Promise<TimeEntry> {
  // Idempotency: replay returns the existing entry.
  const existingEvent = await db.query<{ time_entry_id: string | null }>(
    `SELECT time_entry_id FROM time_entry_events
     WHERE organization_id = $1 AND user_id = $2 AND client_generated_id = $3
     LIMIT 1`,
    [user.organizationId, user.userId, input.clientGeneratedId],
  );
  if (existingEvent.rows[0]?.time_entry_id) {
    const { rows } = await db.query<TimeEntryRow>(
      'SELECT * FROM time_entries WHERE id = $1',
      [existingEvent.rows[0].time_entry_id],
    );
    if (rows[0]) return rowToTimeEntry(rows[0]);
  }

  const open = await getCurrentOpenEntry(db, user.userId);
  if (!open) throw AppError.notClockedIn();

  const decision = await evaluateGeofence(db, input.location);

  const { rows: updated } = await db.query<TimeEntryRow>(
    `UPDATE time_entries
     SET punch_out_at = $2,
         punch_out_latitude = $3,
         punch_out_longitude = $4,
         punch_out_accuracy_m = $5,
         punch_out_geofence_id = $6,
         duration_minutes = GREATEST(0,
           EXTRACT(EPOCH FROM ($2::timestamptz - punch_in_at))::int / 60),
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

  return rowToTimeEntry(row);
}

export async function listEntries(
  db: PoolClient,
  user: AuthenticatedUser,
  opts: { userId?: string; fromDate?: string; toDate?: string; limit?: number } = {},
): Promise<TimeEntry[]> {
  const limit = Math.min(opts.limit ?? 100, 500);
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (opts.userId) {
    params.push(opts.userId);
    conditions.push(`user_id = $${params.length}`);
  } else if (user.role === 'employee') {
    // Employees only see their own entries.
    params.push(user.userId);
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
