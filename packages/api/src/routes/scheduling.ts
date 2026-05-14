import type { PoolClient } from 'pg';
import { Router } from 'express';
import { PERMISSIONS, copyWeekSchema, shiftCreateSchema } from '@punchclock/shared';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { withTenantDb } from '../middleware/tenant.js';
import { validateBody } from '../middleware/validation.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { created, noContent, ok } from '../lib/response.js';
import { AppError } from '../lib/errors.js';
import { evaluatePredictiveLock } from '../services/predictive-scheduling.service.js';
import { evaluateScheduleConflict } from '../services/schedule-conflicts.service.js';

export const schedulingRouter = Router();

schedulingRouter.use(requireAuth(), withTenantDb());

function minutesBetween(start: string, end: string): number {
  const [sh, sm] = start.split(':').map(Number) as [number, number];
  const [eh, em] = end.split(':').map(Number) as [number, number];
  const diff = eh * 60 + em - (sh * 60 + sm);
  // Shifts that cross midnight wrap forward 24h.
  return diff <= 0 ? diff + 24 * 60 : diff;
}

interface PredictiveLockGateInput {
  db: PoolClient;
  scheduledDate: string; // YYYY-MM-DD
  forceQuery: unknown;
  actorUserId: string;
  organizationId: string;
  action: 'shift_created' | 'shift_deleted';
  resourceId: string;
  ipAddress: string | null;
}

interface ShiftProposal {
  userId: string;
  scheduledDate: string;
  shiftStart: string;
  shiftEnd: string;
}

async function detectShiftConflict(
  db: PoolClient,
  proposal: ShiftProposal,
): Promise<ReturnType<typeof evaluateScheduleConflict>> {
  // Same-date overlap candidates (exclude cancelled and time_off rows).
  const { rows: existingOnDate } = await db.query<{
    scheduled_date: string;
    shift_start: string;
    shift_end: string;
    duration_minutes: number;
  }>(
    `SELECT to_char(scheduled_date, 'YYYY-MM-DD') AS scheduled_date,
            shift_start, shift_end, duration_minutes
     FROM shifts
     WHERE user_id = $1 AND scheduled_date = $2::date
       AND status <> 'cancelled' AND shift_type <> 'time_off'`,
    [proposal.userId, proposal.scheduledDate],
  );

  // Mon-Sun week scheduled minutes (exclude cancelled + time_off + the
  // proposed slot itself, which doesn't yet exist).
  const { rows: weekRows } = await db.query<{ minutes: string }>(
    `SELECT COALESCE(SUM(duration_minutes), 0)::text AS minutes
     FROM shifts
     WHERE user_id = $1
       AND status <> 'cancelled' AND shift_type <> 'time_off'
       AND scheduled_date >= date_trunc('week', $2::date)
       AND scheduled_date <  date_trunc('week', $2::date) + INTERVAL '7 days'`,
    [proposal.userId, proposal.scheduledDate],
  );
  const weekScheduledMinutes = Number(weekRows[0]?.minutes ?? 0);

  // Org cap.
  const { rows: orgRows } = await db.query<{ max_weekly_minutes: number }>(
    `SELECT max_weekly_minutes FROM organizations LIMIT 1`,
  );
  const maxWeeklyMinutes = Number(orgRows[0]?.max_weekly_minutes ?? 2400);

  // Most recent shift end strictly before this proposal (any date,
  // bounded to last 14 days for index efficiency).
  const { rows: prevRows } = await db.query<{ end_iso: string }>(
    `SELECT (scheduled_date::timestamp + shift_end::time)::text AS end_iso
     FROM shifts
     WHERE user_id = $1
       AND status <> 'cancelled' AND shift_type <> 'time_off'
       AND scheduled_date BETWEEN $2::date - INTERVAL '14 days' AND $2::date
       AND (scheduled_date < $2::date
            OR (scheduled_date = $2::date AND shift_end <= $3))
     ORDER BY scheduled_date DESC, shift_end DESC
     LIMIT 1`,
    [proposal.userId, proposal.scheduledDate, proposal.shiftStart],
  );
  const previousShiftEndIso = prevRows[0]?.end_iso ?? null;

  return evaluateScheduleConflict({
    proposed: proposal,
    existingOnDate: existingOnDate.map((r) => ({
      scheduledDate: r.scheduled_date,
      shiftStart: r.shift_start,
      shiftEnd: r.shift_end,
      durationMinutes: r.duration_minutes,
    })),
    weekScheduledMinutes,
    maxWeeklyMinutes,
    previousShiftEndIso,
  });
}

/**
 * Reads the org's predictive-scheduling flag + timezone, runs the
 * pure window check, and either throws AppError.predictiveLock or
 * (when force=true) writes an override audit row before allowing
 * the change.
 */
async function applyPredictiveLockGate(input: PredictiveLockGateInput): Promise<void> {
  const { rows } = await input.db.query<{
    feature_predictive_scheduling: boolean;
    timezone: string;
  }>(`SELECT feature_predictive_scheduling, timezone FROM organizations LIMIT 1`);
  const orgRow = rows[0];
  if (!orgRow) return;

  const forceOverride = input.forceQuery === 'true' || input.forceQuery === true;
  const today = new Date(); // org-tz tolerance is ±1 day; the law cares about days
  const [y, m, d] = input.scheduledDate.split('-').map(Number) as [number, number, number];
  const scheduledDate = new Date(Date.UTC(y, m - 1, d));

  const decision = evaluatePredictiveLock({
    enabled: orgRow.feature_predictive_scheduling,
    today,
    scheduledDate,
    forceOverride,
  });
  if (!decision.allowed) {
    throw AppError.predictiveLock({
      scheduledDate: input.scheduledDate,
      noticeDays: decision.noticeDays,
      windowDays: 14,
    });
  }
  if (decision.forcedThrough) {
    await input.db.query(
      `INSERT INTO audit_logs
         (organization_id, actor_user_id, resource_type, resource_id, action, changes, ip_address)
       VALUES ($1, $2, 'shift', $3, $4, $5::jsonb, $6)`,
      [
        input.organizationId,
        input.actorUserId,
        input.resourceId,
        `predictive_override.${input.action}`,
        JSON.stringify({
          scheduledDate: input.scheduledDate,
          noticeDays: decision.noticeDays,
          windowDays: 14,
        }),
        input.ipAddress,
      ],
    );
  }
}

schedulingRouter.get(
  '/shifts',
  asyncHandler(async (req, res) => {
    const db = res.locals.db;
    if (!db || !req.user) throw AppError.unauthorized();
    const from = typeof req.query.from === 'string' ? req.query.from : null;
    const to = typeof req.query.to === 'string' ? req.query.to : null;
    const userId =
      typeof req.query.userId === 'string'
        ? req.query.userId
        : req.user.role === 'employee'
          ? req.user.userId
          : null;
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (from) {
      params.push(from);
      conditions.push(`scheduled_date >= $${params.length}`);
    }
    if (to) {
      params.push(to);
      conditions.push(`scheduled_date <= $${params.length}`);
    }
    if (userId) {
      params.push(userId);
      conditions.push(`user_id = $${params.length}`);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await db.query(
      `SELECT id, user_id,
              to_char(scheduled_date, 'YYYY-MM-DD') AS scheduled_date,
              shift_start, shift_end, duration_minutes,
              shift_type, required_break_minutes, status, notes, created_at
       FROM shifts ${where}
       ORDER BY scheduled_date ASC, shift_start ASC
       LIMIT 500`,
      params,
    );
    ok(res, rows);
  }),
);

schedulingRouter.post(
  '/shifts',
  requirePermission(PERMISSIONS.EDIT_SCHEDULE),
  validateBody(shiftCreateSchema),
  asyncHandler(async (req, res) => {
    const db = res.locals.db;
    if (!db || !req.user) throw AppError.unauthorized();

    await applyPredictiveLockGate({
      db,
      scheduledDate: req.body.scheduledDate,
      forceQuery: req.query.force,
      actorUserId: req.user.userId,
      organizationId: req.user.organizationId,
      action: 'shift_created',
      resourceId: 'pending', // updated below if override actually wrote a row
      ipAddress: req.ip ?? null,
    });

    // Conflict pre-flight (skippable with ?force=true).
    const forceConflict = req.query.force === 'true';
    if (!forceConflict) {
      const conflict = await detectShiftConflict(db, {
        userId: req.body.userId,
        scheduledDate: req.body.scheduledDate,
        shiftStart: req.body.shiftStart,
        shiftEnd: req.body.shiftEnd,
      });
      if (conflict.conflict !== null) {
        throw AppError.scheduleConflict({
          conflict: conflict.conflict,
          message: conflict.message,
          ...(conflict.details ?? {}),
        });
      }
    }

    const duration = minutesBetween(req.body.shiftStart, req.body.shiftEnd);
    const { rows } = await db.query(
      `INSERT INTO shifts
         (organization_id, user_id, scheduled_date, shift_start, shift_end,
          duration_minutes, shift_type, required_break_minutes, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, user_id, to_char(scheduled_date, 'YYYY-MM-DD') AS scheduled_date,
                 shift_start, shift_end, duration_minutes, shift_type, status`,
      [
        req.user.organizationId,
        req.body.userId,
        req.body.scheduledDate,
        req.body.shiftStart,
        req.body.shiftEnd,
        duration,
        req.body.shiftType,
        req.body.requiredBreakMinutes,
        req.body.notes ?? null,
      ],
    );
    created(res, rows[0]);
  }),
);

schedulingRouter.post(
  '/shifts/copy-week',
  requirePermission(PERMISSIONS.EDIT_SCHEDULE),
  validateBody(copyWeekSchema),
  asyncHandler(async (req, res) => {
    const db = res.locals.db;
    if (!db || !req.user) throw AppError.unauthorized();
    const { fromMonday, toMonday } = req.body as { fromMonday: string; toMonday: string };

    // Pull source week (excluding cancelled + time_off).
    const { rows: source } = await db.query<{
      user_id: string;
      shift_start: string;
      shift_end: string;
      duration_minutes: number;
      shift_type: string;
      required_break_minutes: number;
      notes: string | null;
      day_offset: string;
    }>(
      `SELECT user_id, shift_start, shift_end, duration_minutes,
              shift_type, required_break_minutes, notes,
              (scheduled_date - $1::date)::text AS day_offset
       FROM shifts
       WHERE scheduled_date >= $1::date
         AND scheduled_date <  $1::date + INTERVAL '7 days'
         AND status <> 'cancelled' AND shift_type <> 'time_off'`,
      [fromMonday],
    );

    let inserted = 0;
    for (const s of source) {
      // Skip if a non-cancelled shift already exists in the target slot.
      const targetDate = `($1::date + ($2 || ' days')::interval)::date`;
      const { rows: dup } = await db.query<{ id: string }>(
        `SELECT id FROM shifts
         WHERE user_id = $3 AND scheduled_date = ${targetDate}
           AND shift_start = $4 AND status <> 'cancelled'
         LIMIT 1`,
        [toMonday, s.day_offset, s.user_id, s.shift_start],
      );
      if (dup.length > 0) continue;
      await db.query(
        `INSERT INTO shifts
           (organization_id, user_id, scheduled_date, shift_start, shift_end,
            duration_minutes, shift_type, required_break_minutes, notes)
         VALUES ($1, $2, ${targetDate}, $5, $6, $7, $8, $9, $10)`,
        [
          req.user.organizationId,
          s.user_id,
          toMonday,
          s.day_offset,
          s.shift_start,
          s.shift_end,
          s.duration_minutes,
          s.shift_type,
          s.required_break_minutes,
          s.notes,
        ],
      );
      inserted += 1;
    }

    ok(res, { fromMonday, toMonday, sourceCount: source.length, inserted });
  }),
);

schedulingRouter.delete(
  '/shifts/:id',
  requirePermission(PERMISSIONS.EDIT_SCHEDULE),
  asyncHandler(async (req, res) => {
    const db = res.locals.db;
    if (!db || !req.user) throw AppError.unauthorized();
    const id = req.params.id;
    if (!id) throw AppError.validation('shift id required');

    // Need the scheduled_date to evaluate the predictive window.
    const { rows: existing } = await db.query<{ scheduled_date: string }>(
      `SELECT to_char(scheduled_date, 'YYYY-MM-DD') AS scheduled_date FROM shifts WHERE id = $1`,
      [id],
    );
    if (existing.length === 0) throw AppError.notFound('Shift');

    await applyPredictiveLockGate({
      db,
      scheduledDate: existing[0]!.scheduled_date,
      forceQuery: req.query.force,
      actorUserId: req.user.userId,
      organizationId: req.user.organizationId,
      action: 'shift_deleted',
      resourceId: id,
      ipAddress: req.ip ?? null,
    });

    await db.query('DELETE FROM shifts WHERE id = $1', [id]);
    noContent(res);
  }),
);
