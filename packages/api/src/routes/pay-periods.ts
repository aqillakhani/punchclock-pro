/**
 * Pay-period routes — the payroll calendar and its locks.
 *
 * Mounted at /api/v1/admin/pay-periods. Kept out of admin.ts, which is
 * already the largest file in the package.
 *
 *   GET    /                 recent periods with lock state and hours
 *   POST   /lock             owner declares a period final
 *   POST   /unlock           owner reopens it (reason required)
 */
import { Router } from 'express';
import {
  PERMISSIONS,
  payPeriodLockSchema,
  payPeriodUnlockSchema,
  type PayPeriodLockInput,
  type PayPeriodUnlockInput,
} from '@punchclock/shared';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { withTenantDb } from '../middleware/tenant.js';
import { validateBody } from '../middleware/validation.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { ok } from '../lib/response.js';
import { AppError } from '../lib/errors.js';
import {
  listPayPeriods,
  loadPayPeriodContext,
  payPeriodFor,
} from '../services/pay-period.service.js';
import { AUDIT_ACTIONS, logAudit } from '../services/audit.service.js';

export const payPeriodsRouter = Router();

payPeriodsRouter.use(requireAuth(), withTenantDb());

function auditCtx(req: { ip?: string; headers: Record<string, unknown> }) {
  return {
    ipAddress: req.ip ?? null,
    userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
  };
}

payPeriodsRouter.get(
  '/',
  requirePermission(PERMISSIONS.VIEW_PAY_PERIODS),
  asyncHandler(async (req, res) => {
    const db = res.locals.db;
    if (!db) throw AppError.unauthorized();
    const count = req.query.count ? Number(req.query.count) : undefined;
    const periods = await listPayPeriods(db, {
      count: Number.isFinite(count) ? count : undefined,
    });
    ok(res, periods, { count: periods.length });
  }),
);

payPeriodsRouter.post(
  '/lock',
  requirePermission(PERMISSIONS.LOCK_PAY_PERIOD),
  validateBody(payPeriodLockSchema),
  asyncHandler(async (req, res) => {
    const db = res.locals.db;
    if (!db || !req.user) throw AppError.unauthorized();
    const body = req.body as PayPeriodLockInput;
    const ctx = await loadPayPeriodContext(db);

    // Normalise to the real boundaries so a caller cannot lock an
    // arbitrary date range by hand-crafting a start date.
    const period = payPeriodFor(body.startDate, ctx);
    if (period.startDate !== body.startDate) {
      throw AppError.validation(
        `${body.startDate} is not the first day of a pay period. The period containing it starts ${period.startDate}.`,
      );
    }

    const { rows } = await db.query<{ start_date: string; end_date: string; status: string }>(
      `INSERT INTO pay_periods
         (organization_id, start_date, end_date, status, locked_by, locked_at, note)
       VALUES ($1, $2, $3, 'locked', $4, NOW(), $5)
       ON CONFLICT (organization_id, start_date) DO UPDATE
         SET status = 'locked', locked_by = $4, locked_at = NOW(),
             note = $5, updated_at = NOW()
       RETURNING to_char(start_date, 'YYYY-MM-DD') AS start_date,
                 to_char(end_date,   'YYYY-MM-DD') AS end_date,
                 status`,
      [
        req.user.organizationId,
        period.startDate,
        period.endDate,
        req.user.userId,
        body.note ?? null,
      ],
    );

    await logAudit(db, {
      organizationId: req.user.organizationId,
      actorUserId: req.user.userId,
      resourceType: 'pay_period',
      resourceId: period.startDate,
      action: AUDIT_ACTIONS.PAY_PERIOD_LOCKED,
      changes: { startDate: period.startDate, endDate: period.endDate, note: body.note ?? null },
      ...auditCtx(req),
    });

    ok(res, rows[0]);
  }),
);

payPeriodsRouter.post(
  '/unlock',
  requirePermission(PERMISSIONS.LOCK_PAY_PERIOD),
  validateBody(payPeriodUnlockSchema),
  asyncHandler(async (req, res) => {
    const db = res.locals.db;
    if (!db || !req.user) throw AppError.unauthorized();
    const body = req.body as PayPeriodUnlockInput;

    const { rows } = await db.query<{ start_date: string; end_date: string; status: string }>(
      `UPDATE pay_periods
       SET status = 'open', unlocked_by = $2, unlocked_at = NOW(),
           note = $3, updated_at = NOW()
       WHERE start_date = $1 AND status = 'locked'
       RETURNING to_char(start_date, 'YYYY-MM-DD') AS start_date,
                 to_char(end_date,   'YYYY-MM-DD') AS end_date,
                 status`,
      [body.startDate, req.user.userId, body.reason],
    );
    if (rows.length === 0) {
      throw AppError.conflict('That pay period is not locked');
    }

    await logAudit(db, {
      organizationId: req.user.organizationId,
      actorUserId: req.user.userId,
      resourceType: 'pay_period',
      resourceId: body.startDate,
      action: AUDIT_ACTIONS.PAY_PERIOD_UNLOCKED,
      // The reason is the point of this audit row — a reopened period
      // means payroll that was declared final is being changed.
      changes: { startDate: body.startDate, reason: body.reason },
      ...auditCtx(req),
    });

    ok(res, rows[0]);
  }),
);
