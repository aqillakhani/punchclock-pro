import type { PoolClient } from 'pg';
import {
  BREAK_TYPES,
  EVENT_TYPES,
  type AuthenticatedUser,
  type Break,
  type BreakType,
  type UUID,
} from '@punchclock/shared';
import { AppError } from '../lib/errors.js';
import { publishTimeEvent } from '../events/publisher.js';

// ---- Meal-break rules (design B6) ---------------------------------
// Pure evaluator + types live in meal-break.service.ts so tests can
// import them without the publisher → logger → env chain.

export {
  evaluateMealBreak,
  type MealBreakInput,
  type MealBreakEvaluation,
  type MealBreakWarning,
  type Worksite,
} from './meal-break.service.js';

/**
 * Sum the completed UNPAID break minutes on an entry — the number that
 * gets subtracted from payable time.
 *
 * Short rest breaks (`break_type='standard'`) are excluded on purpose:
 * under the FLSA, rest periods of roughly 20 minutes or less are
 * compensable hours worked and must stay paid. Only meal periods
 * ('lunch') and explicitly unpaid breaks come off the clock.
 *
 * Must stay in step with `UNPAID_BREAK_TYPES` in the shared package and
 * with the backfill in migration 007.
 */
export async function loadUnpaidBreakMinutes(db: PoolClient, timeEntryId: string): Promise<number> {
  const { rows } = await db.query<{ total_minutes: string }>(
    `SELECT COALESCE(SUM(duration_minutes), 0)::text AS total_minutes
     FROM breaks
     WHERE time_entry_id = $1
       AND status = 'completed'
       AND break_type IN ('lunch', 'unpaid')`,
    [timeEntryId],
  );
  return Number(rows[0]?.total_minutes ?? 0);
}

/**
 * Meal-break compliance uses the same set of breaks as the payable-time
 * deduction, so this is an alias kept for call-site clarity: the
 * compliance evaluator asks "did they get their meal break?", the payroll
 * path asks "how much time is unpaid?".
 */
export const loadMealBreakMinutes = loadUnpaidBreakMinutes;

/**
 * Close any break still running when the worker punches out.
 *
 * Without this a forgotten break stays `in_progress` forever, is never
 * counted, and the meal period silently becomes paid time. Ending it at
 * the punch-out instant is the honest reading: the worker was not back
 * on the clock before the shift ended.
 *
 * Returns the number of breaks closed.
 */
export async function closeOpenBreaks(
  db: PoolClient,
  timeEntryId: string,
  endedAt: string,
): Promise<number> {
  const { rowCount } = await db.query(
    `UPDATE breaks
     SET break_end = $2,
         duration_minutes = GREATEST(0,
           EXTRACT(EPOCH FROM ($2::timestamptz - break_start))::int / 60),
         status = 'completed',
         updated_at = NOW()
     WHERE time_entry_id = $1
       AND status = 'in_progress'
       AND $2::timestamptz > break_start`,
    [timeEntryId, endedAt],
  );
  return rowCount ?? 0;
}

interface BreakRow {
  id: string;
  organization_id: string;
  time_entry_id: string;
  user_id: string;
  break_start: string;
  break_end: string | null;
  duration_minutes: number | null;
  break_type: BreakType;
  status: 'in_progress' | 'completed' | 'cancelled';
  created_at: string;
}

function rowToBreak(row: BreakRow): Break {
  return {
    id: row.id,
    organizationId: row.organization_id,
    timeEntryId: row.time_entry_id,
    breakStart: row.break_start,
    breakEnd: row.break_end,
    durationMinutes: row.duration_minutes,
    breakType: row.break_type,
    status: row.status,
    createdAt: row.created_at,
  };
}

export async function startBreak(
  db: PoolClient,
  user: AuthenticatedUser,
  input: {
    timeEntryId: UUID;
    timestamp: string;
    breakType?: BreakType;
    clientGeneratedId: string;
  },
): Promise<Break> {
  // Verify the time entry belongs to this user and is open.
  const entry = await db.query<{ id: string; status: string }>(
    `SELECT id, status FROM time_entries
     WHERE id = $1 AND user_id = $2 AND punch_out_at IS NULL`,
    [input.timeEntryId, user.userId],
  );
  if (entry.rows.length === 0) throw AppError.notFound('Open time entry');

  const existingOpen = await db.query<BreakRow>(
    `SELECT * FROM breaks WHERE time_entry_id = $1 AND status = 'in_progress' LIMIT 1`,
    [input.timeEntryId],
  );
  if (existingOpen.rows[0]) {
    throw AppError.conflict('Break already in progress for this entry');
  }

  const { rows } = await db.query<BreakRow>(
    `INSERT INTO breaks (organization_id, time_entry_id, user_id, break_start, break_type, status)
     VALUES ($1, $2, $3, $4, $5, 'in_progress')
     RETURNING *`,
    [
      user.organizationId,
      input.timeEntryId,
      user.userId,
      input.timestamp,
      input.breakType ?? BREAK_TYPES.STANDARD,
    ],
  );
  const row = rows[0]!;

  await publishTimeEvent(db, {
    organizationId: user.organizationId,
    userId: user.userId,
    actorUserId: user.userId,
    eventType: EVENT_TYPES.BREAK_START,
    eventData: {
      breakId: row.id,
      timeEntryId: input.timeEntryId,
      breakType: row.break_type,
    },
    clientGeneratedId: input.clientGeneratedId,
    timeEntryId: input.timeEntryId,
    recordedAt: new Date(input.timestamp),
  });

  return rowToBreak(row);
}

export async function endBreak(
  db: PoolClient,
  user: AuthenticatedUser,
  input: { breakId: UUID; timestamp: string; clientGeneratedId: string },
): Promise<Break> {
  const { rows } = await db.query<BreakRow>(
    `UPDATE breaks
     SET break_end = $2,
         duration_minutes = GREATEST(0,
           EXTRACT(EPOCH FROM ($2::timestamptz - break_start))::int / 60),
         status = 'completed',
         updated_at = NOW()
     WHERE id = $1 AND user_id = $3 AND status = 'in_progress'
     RETURNING *`,
    [input.breakId, input.timestamp, user.userId],
  );
  if (rows.length === 0) throw AppError.notFound('In-progress break');
  const row = rows[0]!;

  await publishTimeEvent(db, {
    organizationId: user.organizationId,
    userId: user.userId,
    actorUserId: user.userId,
    eventType: EVENT_TYPES.BREAK_END,
    eventData: { breakId: row.id, durationMinutes: row.duration_minutes },
    clientGeneratedId: input.clientGeneratedId,
    timeEntryId: row.time_entry_id,
    recordedAt: new Date(input.timestamp),
  });

  return rowToBreak(row);
}
