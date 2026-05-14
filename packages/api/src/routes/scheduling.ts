import type { PoolClient } from 'pg';
import { Router } from 'express';
import { PERMISSIONS, shiftCreateSchema } from '@punchclock/shared';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { withTenantDb } from '../middleware/tenant.js';
import { validateBody } from '../middleware/validation.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { created, noContent, ok } from '../lib/response.js';
import { AppError } from '../lib/errors.js';
import { evaluatePredictiveLock } from '../services/predictive-scheduling.service.js';

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
