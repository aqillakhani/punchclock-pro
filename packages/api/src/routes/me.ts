/**
 * Worker self-service endpoints (`/api/v1/me/*`).
 *
 * Every route here scopes results to `req.user.userId` — there is
 * no admin-by-id variant. Manager-side actions live in admin.ts.
 *
 * Routes:
 *   GET  /timesheet?from=&to=          — own weekly hours + estimated pay
 *   GET  /schedule?from=&to=           — own shifts
 *   POST /time-off                     — submit a PTO request
 *   GET  /time-off                     — list my requests
 *   POST /shift-trade                  — post one of my shifts for swap
 *   POST /shift-trade/:id/accept       — pick up an open trade
 */
import { Router } from 'express';
import {
  PERMISSIONS,
  shiftTradePostSchema,
  timeOffRequestSchema,
  type ShiftTradePostInput,
  type TimeOffRequestInput,
} from '@punchclock/shared';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { withTenantDb } from '../middleware/tenant.js';
import { validateBody } from '../middleware/validation.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { created, ok } from '../lib/response.js';
import { AppError } from '../lib/errors.js';
import { calculateOvertime, type OvertimeJurisdiction } from '../services/overtime.service.js';

export const meRouter = Router();

meRouter.use(requireAuth(), withTenantDb());

// ---- Own timesheet --------------------------------------------------

meRouter.get(
  '/timesheet',
  requirePermission(PERMISSIONS.VIEW_MY_TIMESHEET),
  asyncHandler(async (req, res) => {
    const db = res.locals.db;
    if (!db || !req.user) throw AppError.unauthorized();

    const from = typeof req.query.from === 'string' ? req.query.from : null;
    const to = typeof req.query.to === 'string' ? req.query.to : null;
    if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      throw AppError.validation('from and to must be YYYY-MM-DD');
    }
    const jurisdiction: OvertimeJurisdiction =
      req.query.jurisdiction === 'california' ? 'california' : 'federal';

    const { rows: orgRows } = await db.query<{ timezone: string }>(
      `SELECT timezone FROM organizations LIMIT 1`,
    );
    const orgTimezone = orgRows[0]?.timezone ?? 'UTC';

    const { rows: userRows } = await db.query<{
      first_name: string | null;
      last_name: string | null;
      role: string;
      pay_rate: string | null;
      pay_currency: string;
      worker_type: string;
    }>(
      `SELECT first_name, last_name, role, pay_rate, pay_currency, worker_type
       FROM users WHERE id = $1`,
      [req.user.userId],
    );
    if (userRows.length === 0) throw AppError.notFound('User');
    const u = userRows[0]!;

    const { rows: entryRows } = await db.query<{
      day: string;
      total_minutes: string;
    }>(
      `SELECT to_char((punch_in_at AT TIME ZONE $3)::date, 'YYYY-MM-DD') AS day,
              SUM(duration_minutes)::text AS total_minutes
       FROM time_entries
       WHERE user_id = $4 AND status='completed'
         AND punch_in_at >= ($1::date) AT TIME ZONE $3
         AND punch_in_at <  (($2::date) + INTERVAL '1 day') AT TIME ZONE $3
       GROUP BY day`,
      [from, to, orgTimezone, req.user.userId],
    );

    const hoursByDay = new Map<string, number>(
      entryRows.map((r) => [r.day, Number(r.total_minutes ?? 0) / 60]),
    );
    const days = enumerateDays(from, to).map((d) => ({ date: d, hours: hoursByDay.get(d) ?? 0 }));
    const totalHours = days.reduce((sum, d) => sum + d.hours, 0);
    const weeks = splitIntoWeeks(days);
    const ot = weeks.reduce(
      (acc, week) => {
        const w = calculateOvertime(week, jurisdiction);
        acc.regularHours += w.regularHours;
        acc.overtimeHours += w.overtimeHours;
        acc.doubleTimeHours += w.doubleTimeHours;
        return acc;
      },
      { regularHours: 0, overtimeHours: 0, doubleTimeHours: 0 },
    );
    const rate = u.pay_rate ? Number(u.pay_rate) : 0;
    // 1099 contractors don't get OT under FLSA — straight-time only.
    const estimatedPay =
      u.worker_type === 'contractor_1099'
        ? totalHours * rate
        : ot.regularHours * rate + ot.overtimeHours * rate * 1.5 + ot.doubleTimeHours * rate * 2;

    ok(res, {
      firstName: u.first_name,
      lastName: u.last_name,
      role: u.role,
      payRate: rate,
      payCurrency: u.pay_currency,
      workerType: u.worker_type,
      days,
      totalHours,
      regularHours: u.worker_type === 'contractor_1099' ? totalHours : ot.regularHours,
      overtimeHours: u.worker_type === 'contractor_1099' ? 0 : ot.overtimeHours,
      doubleTimeHours: u.worker_type === 'contractor_1099' ? 0 : ot.doubleTimeHours,
      estimatedPay,
    });
  }),
);

// ---- Own schedule ---------------------------------------------------

meRouter.get(
  '/schedule',
  requirePermission(PERMISSIONS.VIEW_MY_SCHEDULE),
  asyncHandler(async (req, res) => {
    const db = res.locals.db;
    if (!db || !req.user) throw AppError.unauthorized();
    const from = typeof req.query.from === 'string' ? req.query.from : null;
    const to = typeof req.query.to === 'string' ? req.query.to : null;
    const conditions: string[] = ['user_id = $1'];
    const params: unknown[] = [req.user.userId];
    if (from) {
      params.push(from);
      conditions.push(`scheduled_date >= $${params.length}`);
    }
    if (to) {
      params.push(to);
      conditions.push(`scheduled_date <= $${params.length}`);
    }
    const { rows } = await db.query(
      `SELECT id, user_id,
              to_char(scheduled_date, 'YYYY-MM-DD') AS scheduled_date,
              shift_start, shift_end, duration_minutes,
              shift_type, required_break_minutes, status, notes
       FROM shifts WHERE ${conditions.join(' AND ')}
       ORDER BY scheduled_date ASC, shift_start ASC
       LIMIT 200`,
      params,
    );
    ok(res, rows);
  }),
);

// ---- Time-off requests ----------------------------------------------

meRouter.get(
  '/time-off',
  requirePermission(PERMISSIONS.VIEW_TIME_OFF),
  asyncHandler(async (req, res) => {
    const db = res.locals.db;
    if (!db || !req.user) throw AppError.unauthorized();
    const { rows } = await db.query(
      `SELECT id,
              to_char(start_date, 'YYYY-MM-DD') AS start_date,
              to_char(end_date,   'YYYY-MM-DD') AS end_date,
              reason, status, decided_by, decided_at, created_at
       FROM time_off_requests
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 100`,
      [req.user.userId],
    );
    ok(res, rows);
  }),
);

meRouter.post(
  '/time-off',
  requirePermission(PERMISSIONS.SUBMIT_TIME_OFF),
  validateBody(timeOffRequestSchema),
  asyncHandler(async (req, res) => {
    const db = res.locals.db;
    if (!db || !req.user) throw AppError.unauthorized();
    const body = req.body as TimeOffRequestInput;
    const { rows } = await db.query(
      `INSERT INTO time_off_requests
         (organization_id, user_id, start_date, end_date, reason, status)
       VALUES ($1, $2, $3, $4, $5, 'pending')
       RETURNING id, to_char(start_date, 'YYYY-MM-DD') AS start_date,
                 to_char(end_date,   'YYYY-MM-DD') AS end_date,
                 reason, status, created_at`,
      [req.user.organizationId, req.user.userId, body.startDate, body.endDate, body.reason ?? null],
    );
    created(res, rows[0]);
  }),
);

// ---- Shift trades ---------------------------------------------------

meRouter.post(
  '/shift-trade',
  requirePermission(PERMISSIONS.POST_TRADE),
  validateBody(shiftTradePostSchema),
  asyncHandler(async (req, res) => {
    const db = res.locals.db;
    if (!db || !req.user) throw AppError.unauthorized();
    const body = req.body as ShiftTradePostInput;

    // Only the shift's owner can post it for trade.
    const { rows: shiftRows } = await db.query<{ user_id: string; status: string }>(
      `SELECT user_id, status FROM shifts WHERE id = $1`,
      [body.shiftId],
    );
    const shift = shiftRows[0];
    if (!shift) throw AppError.notFound('Shift');
    if (shift.user_id !== req.user.userId) {
      throw AppError.forbidden('You can only post your own shifts for trade');
    }
    if (shift.status !== 'scheduled') {
      throw AppError.validation('Only scheduled shifts can be posted for trade');
    }

    // Refuse a duplicate open trade for the same shift.
    const { rows: existingRows } = await db.query<{ id: string }>(
      `SELECT id FROM shift_trades WHERE shift_id = $1 AND status IN ('open','accepted')`,
      [body.shiftId],
    );
    if (existingRows[0]) {
      throw AppError.conflict('This shift already has an open trade');
    }

    const { rows } = await db.query(
      `INSERT INTO shift_trades
         (organization_id, shift_id, from_user_id, status)
       VALUES ($1, $2, $3, 'open')
       RETURNING id, shift_id, from_user_id, to_user_id, status, created_at`,
      [req.user.organizationId, body.shiftId, req.user.userId],
    );
    created(res, rows[0]);
  }),
);

meRouter.get(
  '/shift-trade',
  requirePermission(PERMISSIONS.VIEW_TRADES),
  asyncHandler(async (req, res) => {
    const db = res.locals.db;
    if (!db || !req.user) throw AppError.unauthorized();
    // Show open trades from anyone (so workers can pick them up) plus
    // my own trades (in any state).
    const { rows } = await db.query(
      `SELECT st.id, st.shift_id, st.from_user_id, st.to_user_id, st.status,
              st.decided_by, st.decided_at, st.created_at,
              fu.first_name AS from_first_name, fu.last_name AS from_last_name,
              tu.first_name AS to_first_name,   tu.last_name AS to_last_name,
              to_char(s.scheduled_date, 'YYYY-MM-DD') AS scheduled_date,
              s.shift_start, s.shift_end, s.duration_minutes
       FROM shift_trades st
       JOIN shifts s ON s.id = st.shift_id
       JOIN users  fu ON fu.id = st.from_user_id
       LEFT JOIN users tu ON tu.id = st.to_user_id
       WHERE st.status = 'open' OR st.from_user_id = $1 OR st.to_user_id = $1
       ORDER BY st.created_at DESC
       LIMIT 100`,
      [req.user.userId],
    );
    ok(res, rows);
  }),
);

meRouter.post(
  '/shift-trade/:id/accept',
  requirePermission(PERMISSIONS.ACCEPT_TRADE),
  asyncHandler(async (req, res) => {
    const db = res.locals.db;
    if (!db || !req.user) throw AppError.unauthorized();
    const tradeId = req.params.id;
    if (!tradeId) throw AppError.validation('trade id required');

    const { rows: tradeRows } = await db.query<{
      from_user_id: string;
      status: string;
    }>(`SELECT from_user_id, status FROM shift_trades WHERE id = $1`, [tradeId]);
    const trade = tradeRows[0];
    if (!trade) throw AppError.notFound('Shift trade');
    if (trade.status !== 'open') {
      throw AppError.validation(`Trade is not open (status=${trade.status})`);
    }
    if (trade.from_user_id === req.user.userId) {
      throw AppError.validation('You cannot accept your own trade');
    }

    const { rows } = await db.query(
      `UPDATE shift_trades
       SET to_user_id = $1, status = 'accepted', updated_at = NOW()
       WHERE id = $2 AND status = 'open'
       RETURNING id, shift_id, from_user_id, to_user_id, status, created_at`,
      [req.user.userId, tradeId],
    );
    if (rows.length === 0) {
      // Lost the race — someone else accepted between our SELECT and UPDATE.
      throw AppError.conflict('Trade was already accepted');
    }
    ok(res, rows[0]);
  }),
);

// ---- Helpers ---------------------------------------------------------

function enumerateDays(fromIso: string, toIso: string): string[] {
  const out: string[] = [];
  const start = new Date(`${fromIso}T00:00:00Z`);
  const end = new Date(`${toIso}T00:00:00Z`);
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    out.push(`${y}-${m}-${day}`);
  }
  return out;
}

function splitIntoWeeks(
  days: { date: string; hours: number }[],
): { date: string; hours: number }[][] {
  if (days.length === 0) return [];
  const weeks: { date: string; hours: number }[][] = [];
  let current: { date: string; hours: number }[] = [];
  for (const d of days) {
    if (current.length > 0 && new Date(`${d.date}T00:00:00Z`).getUTCDay() === 1) {
      weeks.push(current);
      current = [];
    }
    current.push(d);
  }
  if (current.length > 0) weeks.push(current);
  return weeks;
}
