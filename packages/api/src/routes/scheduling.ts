import { Router } from 'express';
import { ROLES, shiftCreateSchema } from '@punchclock/shared';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { withTenantDb } from '../middleware/tenant.js';
import { validateBody } from '../middleware/validation.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { created, noContent, ok } from '../lib/response.js';
import { AppError } from '../lib/errors.js';

export const schedulingRouter = Router();

schedulingRouter.use(requireAuth(), withTenantDb());

function minutesBetween(start: string, end: string): number {
  const [sh, sm] = start.split(':').map(Number) as [number, number];
  const [eh, em] = end.split(':').map(Number) as [number, number];
  const diff = eh * 60 + em - (sh * 60 + sm);
  // Shifts that cross midnight wrap forward 24h.
  return diff <= 0 ? diff + 24 * 60 : diff;
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
  requireRole(ROLES.MANAGER),
  validateBody(shiftCreateSchema),
  asyncHandler(async (req, res) => {
    const db = res.locals.db;
    if (!db || !req.user) throw AppError.unauthorized();
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
  requireRole(ROLES.MANAGER),
  asyncHandler(async (req, res) => {
    const db = res.locals.db;
    if (!db) throw AppError.unauthorized();
    const result = await db.query('DELETE FROM shifts WHERE id = $1', [req.params.id]);
    if (result.rowCount === 0) throw AppError.notFound('Shift');
    noContent(res);
  }),
);
