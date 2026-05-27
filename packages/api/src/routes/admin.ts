import { Router } from 'express';
import bcrypt from 'bcrypt';
import {
  PERMISSIONS,
  ROLES,
  inviteUserSchema,
  organizationUpdateSchema,
  shiftTradeDecisionSchema,
  timeOffDecisionSchema,
  type InviteUserInput,
} from '@punchclock/shared';
import { loadEnv } from '../config/env.js';
import { requireAuth, requirePermission, requireRole } from '../middleware/auth.js';
import { withTenantDb } from '../middleware/tenant.js';
import { validateBody } from '../middleware/validation.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { created, noContent, ok } from '../lib/response.js';
import { AppError } from '../lib/errors.js';
import { calculateOvertime, type OvertimeJurisdiction } from '../services/overtime.service.js';
import { enumerateDates, materializeTimeOffShifts } from '../services/time-off.service.js';
import {
  generateResetToken,
  hashToken,
  resetTokenExpiry,
  storeResetToken,
} from '../services/password-reset.service.js';
import { inviteEmail, sendEmail, timeOffDecisionEmail } from '../services/email.service.js';
import {
  buildIIF,
  buildQboJson,
  loadWorkersForPeriod,
  resolveAccounts,
} from '../services/payroll-export.service.js';

export const adminRouter = Router();

adminRouter.use(requireAuth(), withTenantDb());

adminRouter.get(
  '/organization',
  asyncHandler(async (_req, res) => {
    const db = res.locals.db;
    if (!db) throw AppError.unauthorized();
    const { rows } = await db.query(
      `SELECT id, name, slug, timezone, industry,
              geofencing_enabled, break_tracking_enabled,
              max_daily_minutes, max_weekly_minutes, cap_enforcement,
              weekly_labor_budget, qb_chart_of_accounts, fx_rates,
              punch_verification_methods, allowed_punch_cidrs,
              feature_cash_drawer, feature_kiosk_qr, feature_predictive_scheduling,
              feature_documents, feature_time_off, feature_shift_trades,
              feature_push_notifications,
              created_at
       FROM organizations LIMIT 1`,
    );
    ok(res, rows[0] ?? null);
  }),
);

adminRouter.patch(
  '/organization',
  requirePermission(PERMISSIONS.EDIT_SETTINGS),
  validateBody(organizationUpdateSchema),
  asyncHandler(async (req, res) => {
    const db = res.locals.db;
    if (!db || !req.user) throw AppError.unauthorized();
    const fields: string[] = [];
    const values: unknown[] = [];

    // Scalar columns mapped 1:1 from request body to db.
    const mapping: Record<string, string> = {
      name: 'name',
      timezone: 'timezone',
      geofencingEnabled: 'geofencing_enabled',
      breakTrackingEnabled: 'break_tracking_enabled',
      maxDailyMinutes: 'max_daily_minutes',
      maxWeeklyMinutes: 'max_weekly_minutes',
      capEnforcement: 'cap_enforcement',
      weeklyLaborBudget: 'weekly_labor_budget',
      featureCashDrawer: 'feature_cash_drawer',
      featureKioskQr: 'feature_kiosk_qr',
      featurePredictiveScheduling: 'feature_predictive_scheduling',
      featureDocuments: 'feature_documents',
      featureTimeOff: 'feature_time_off',
      featureShiftTrades: 'feature_shift_trades',
      featurePushNotifications: 'feature_push_notifications',
    };
    for (const [key, column] of Object.entries(mapping)) {
      if (key in req.body) {
        values.push(req.body[key]);
        fields.push(`${column} = $${values.length}`);
      }
    }
    // JSONB columns need JSON.stringify so pg encodes them correctly.
    if ('punchVerificationMethods' in req.body) {
      values.push(JSON.stringify(req.body.punchVerificationMethods));
      fields.push(`punch_verification_methods = $${values.length}::jsonb`);
    }
    if ('allowedPunchCidrs' in req.body) {
      values.push(JSON.stringify(req.body.allowedPunchCidrs));
      fields.push(`allowed_punch_cidrs = $${values.length}::jsonb`);
    }
    if (fields.length === 0) throw AppError.validation('No updatable fields');
    values.push(req.user.organizationId);
    const { rows } = await db.query(
      `UPDATE organizations SET ${fields.join(', ')}, updated_at = NOW()
       WHERE id = $${values.length}
       RETURNING id, name, slug, timezone, geofencing_enabled, break_tracking_enabled,
                 max_daily_minutes, max_weekly_minutes, cap_enforcement,
                 weekly_labor_budget, punch_verification_methods, allowed_punch_cidrs,
                 feature_cash_drawer, feature_kiosk_qr, feature_predictive_scheduling,
                 feature_documents, feature_time_off, feature_shift_trades,
                 feature_push_notifications`,
      values,
    );
    ok(res, rows[0]);
  }),
);

adminRouter.get(
  '/users',
  requirePermission(PERMISSIONS.VIEW_TEAM),
  asyncHandler(async (_req, res) => {
    const db = res.locals.db;
    if (!db) throw AppError.unauthorized();
    const { rows } = await db.query(
      `SELECT id, email, phone, first_name, last_name, role, pay_rate, status, last_login_at, created_at
       FROM users WHERE deleted_at IS NULL ORDER BY created_at DESC`,
    );
    ok(res, rows);
  }),
);

adminRouter.get(
  '/team-status',
  asyncHandler(async (_req, res) => {
    const db = res.locals.db;
    if (!db) throw AppError.unauthorized();
    const { rows } = await db.query<{
      total_active: string;
      clocked_in: string;
      last_recorded_at: string | null;
      last_first_name: string | null;
      last_last_name: string | null;
      last_event_type: string | null;
    }>(
      `SELECT
        (SELECT COUNT(*) FROM users WHERE deleted_at IS NULL AND status='active') AS total_active,
        (SELECT COUNT(*) FROM time_entries WHERE punch_out_at IS NULL AND status='in_progress') AS clocked_in,
        last.recorded_at AS last_recorded_at,
        last.first_name AS last_first_name,
        last.last_name AS last_last_name,
        last.event_type AS last_event_type
       FROM (
         SELECT e.recorded_at, u.first_name, u.last_name, e.event_type
         FROM time_entry_events e
         JOIN users u ON u.id = e.user_id
         ORDER BY e.recorded_at DESC
         LIMIT 1
       ) AS last
       RIGHT JOIN (SELECT 1) AS _ ON TRUE`,
    );
    const row = rows[0];
    ok(res, {
      totalActive: row ? Number(row.total_active) : 0,
      clockedIn: row ? Number(row.clocked_in) : 0,
      lastPunch:
        row && row.last_recorded_at
          ? {
              recordedAt: row.last_recorded_at,
              userName:
                [row.last_first_name, row.last_last_name].filter(Boolean).join(' ').trim() ||
                'Unknown',
              eventType: row.last_event_type,
            }
          : null,
    });
  }),
);

adminRouter.post(
  '/users',
  requirePermission(PERMISSIONS.INVITE_USER),
  validateBody(inviteUserSchema),
  asyncHandler(async (req, res) => {
    const db = res.locals.db;
    if (!db || !req.user) throw AppError.unauthorized();

    // Managers may only invite employees (design §5: "Team — Manager:
    // ✓ full read; add but only `employee` role"). Owner may invite
    // any role.
    if (req.user.role === ROLES.MANAGER && req.body.role !== ROLES.EMPLOYEE) {
      throw AppError.forbidden('Managers may only invite users with role=employee');
    }

    const env = loadEnv();
    const body = req.body as InviteUserInput;
    // When the owner doesn't set a password, the worker gets a setup email
    // and chooses their own (the owner never sees it).
    const passwordHash = body.password ? await bcrypt.hash(body.password, env.BCRYPT_ROUNDS) : null;

    const { rows } = await db.query<{
      id: string;
      email: string;
      first_name: string | null;
      last_name: string | null;
      role: string;
      status: string;
    }>(
      `INSERT INTO users
         (organization_id, email, first_name, last_name, password_hash, role, pay_rate, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'active')
       RETURNING id, email, first_name, last_name, role, status`,
      [
        req.user.organizationId,
        body.email,
        body.firstName ?? null,
        body.lastName ?? null,
        passwordHash,
        body.role,
        body.payRate ?? null,
      ],
    );
    const newUser = rows[0]!;

    if (!passwordHash) {
      const rawToken = generateResetToken();
      await storeResetToken(db, {
        organizationId: req.user.organizationId,
        userId: newUser.id,
        tokenHash: hashToken(rawToken),
        expiresAt: resetTokenExpiry(new Date()),
      });
      const { rows: orgRows } = await db.query<{ name: string }>(
        `SELECT name FROM organizations LIMIT 1`,
      );
      const setupUrl = `${env.WEB_APP_URL}/reset-password?token=${encodeURIComponent(rawToken)}`;
      await sendEmail({
        ...inviteEmail({
          setupUrl,
          orgName: orgRows[0]?.name ?? 'PunchClock Pro',
          firstName: newUser.first_name ?? undefined,
        }),
        to: newUser.email,
      });
    }

    created(res, newUser);
  }),
);

adminRouter.post(
  '/users/:id/reset-pin',
  requirePermission(PERMISSIONS.DELETE_USER),
  asyncHandler(async (req, res) => {
    const db = res.locals.db;
    if (!db) throw AppError.unauthorized();
    const result = await db.query(
      `UPDATE users SET pin_hash = NULL, updated_at = NOW() WHERE id = $1`,
      [req.params.id],
    );
    if (result.rowCount === 0) throw AppError.notFound('User');
    noContent(res);
  }),
);

adminRouter.delete(
  '/users/:id',
  requirePermission(PERMISSIONS.DELETE_USER),
  asyncHandler(async (req, res) => {
    const db = res.locals.db;
    if (!db) throw AppError.unauthorized();
    const result = await db.query(
      `UPDATE users SET status = 'archived', deleted_at = NOW() WHERE id = $1`,
      [req.params.id],
    );
    if (result.rowCount === 0) throw AppError.notFound('User');
    noContent(res);
  }),
);

adminRouter.get(
  '/timesheets',
  requirePermission(PERMISSIONS.VIEW_TIMESHEETS),
  asyncHandler(async (req, res) => {
    const db = res.locals.db;
    if (!db) throw AppError.unauthorized();
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

    const { rows: usersRows } = await db.query<{
      id: string;
      email: string;
      first_name: string | null;
      last_name: string | null;
      role: string;
      pay_rate: string | null;
    }>(
      `SELECT id, email, first_name, last_name, role, pay_rate
       FROM users WHERE deleted_at IS NULL AND status='active' ORDER BY first_name, last_name`,
    );

    const { rows: entryRows } = await db.query<{
      user_id: string;
      day: string;
      total_minutes: string;
    }>(
      `SELECT user_id,
              to_char((punch_in_at AT TIME ZONE $3)::date, 'YYYY-MM-DD') AS day,
              SUM(duration_minutes)::text AS total_minutes
       FROM time_entries
       WHERE status='completed'
         AND punch_in_at >= ($1::date) AT TIME ZONE $3
         AND punch_in_at <  (($2::date) + INTERVAL '1 day') AT TIME ZONE $3
       GROUP BY user_id, day`,
      [from, to, orgTimezone],
    );

    const hoursByUserDay = new Map<string, Map<string, number>>();
    for (const r of entryRows) {
      const minutes = Number(r.total_minutes ?? 0);
      const hours = minutes / 60;
      if (!hoursByUserDay.has(r.user_id)) hoursByUserDay.set(r.user_id, new Map());
      hoursByUserDay.get(r.user_id)!.set(r.day, hours);
    }

    const dayList = enumerateDays(from, to);

    const payload = usersRows.map((u) => {
      const dayMap = hoursByUserDay.get(u.id) ?? new Map();
      const days = dayList.map((d) => ({ date: d, hours: dayMap.get(d) ?? 0 }));
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
      const estimatedPay =
        ot.regularHours * rate + ot.overtimeHours * rate * 1.5 + ot.doubleTimeHours * rate * 2;
      return {
        userId: u.id,
        email: u.email,
        firstName: u.first_name,
        lastName: u.last_name,
        role: u.role,
        payRate: rate,
        days,
        totalHours,
        regularHours: ot.regularHours,
        overtimeHours: ot.overtimeHours,
        doubleTimeHours: ot.doubleTimeHours,
        estimatedPay,
      };
    });

    ok(res, payload);
  }),
);

// ---- Time-off admin queue + decisions -----------------------------

adminRouter.get(
  '/time-off',
  requirePermission(PERMISSIONS.APPROVE_TIME_OFF),
  asyncHandler(async (req, res) => {
    const db = res.locals.db;
    if (!db) throw AppError.unauthorized();
    const status = typeof req.query.status === 'string' ? req.query.status : null;
    const params: unknown[] = [];
    const where: string[] = [];
    if (status) {
      params.push(status);
      where.push(`t.status = $${params.length}`);
    }
    const sql = `
      SELECT t.id,
             to_char(t.start_date, 'YYYY-MM-DD') AS start_date,
             to_char(t.end_date,   'YYYY-MM-DD') AS end_date,
             t.reason, t.status, t.decided_by, t.decided_at, t.created_at,
             u.id AS user_id, u.email, u.first_name, u.last_name
      FROM time_off_requests t
      JOIN users u ON u.id = t.user_id
      ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY t.created_at DESC
      LIMIT 200`;
    const { rows } = await db.query(sql, params);
    ok(res, rows);
  }),
);

adminRouter.post(
  '/time-off/:id/decision',
  requirePermission(PERMISSIONS.APPROVE_TIME_OFF),
  validateBody(timeOffDecisionSchema),
  asyncHandler(async (req, res) => {
    const db = res.locals.db;
    if (!db || !req.user) throw AppError.unauthorized();
    const requestId = req.params.id;
    if (!requestId) throw AppError.validation('time-off id required');

    const { rows: existing } = await db.query<{
      id: string;
      user_id: string;
      start_date: string;
      end_date: string;
      status: string;
      email: string;
      first_name: string | null;
    }>(
      `SELECT t.id, t.user_id,
              to_char(t.start_date, 'YYYY-MM-DD') AS start_date,
              to_char(t.end_date,   'YYYY-MM-DD') AS end_date,
              t.status, u.email, u.first_name
       FROM time_off_requests t
       JOIN users u ON u.id = t.user_id
       WHERE t.id = $1`,
      [requestId],
    );
    if (existing.length === 0) throw AppError.notFound('Time-off request');
    const tor = existing[0]!;
    if (tor.status !== 'pending') {
      throw AppError.conflict(`Request already ${tor.status}`);
    }

    const newStatus = req.body.decision === 'approved' ? 'approved' : 'rejected';
    const { rows: updated } = await db.query(
      `UPDATE time_off_requests
       SET status = $1, decided_by = $2, decided_at = NOW(), updated_at = NOW(),
           reason = CASE WHEN $3::text IS NULL THEN reason
                         ELSE COALESCE(reason, '') ||
                              CASE WHEN reason IS NULL OR reason = '' THEN ''
                                   ELSE ' — ' END || $3 END
       WHERE id = $4
       RETURNING id, status, decided_by, decided_at`,
      [newStatus, req.user.userId, req.body.comment ?? null, requestId],
    );

    let placeholderShifts = 0;
    if (newStatus === 'approved') {
      placeholderShifts = await materializeTimeOffShifts(db, {
        organizationId: req.user.organizationId,
        userId: tor.user_id,
        startDate: tor.start_date,
        endDate: tor.end_date,
        requestId,
      });
    }

    // Notify the requester of the decision (best-effort).
    await sendEmail({
      ...timeOffDecisionEmail({
        decision: newStatus,
        startDate: tor.start_date,
        endDate: tor.end_date,
        firstName: tor.first_name ?? undefined,
        comment: req.body.comment ?? undefined,
      }),
      to: tor.email,
    });

    ok(res, { ...updated[0], placeholderShifts });
  }),
);

// ---- Shift trade admin queue + decisions --------------------------

adminRouter.get(
  '/shift-trade',
  requirePermission(PERMISSIONS.APPROVE_TRADE),
  asyncHandler(async (req, res) => {
    const db = res.locals.db;
    if (!db) throw AppError.unauthorized();
    const status = typeof req.query.status === 'string' ? req.query.status : null;
    const params: unknown[] = [];
    const where: string[] = [];
    if (status) {
      params.push(status);
      where.push(`st.status = $${params.length}`);
    }
    const sql = `
      SELECT st.id, st.shift_id, st.from_user_id, st.to_user_id, st.status,
             st.decided_by, st.decided_at, st.created_at,
             fu.email AS from_email, fu.first_name AS from_first_name,
             fu.last_name AS from_last_name,
             tu.email AS to_email, tu.first_name AS to_first_name,
             tu.last_name AS to_last_name,
             to_char(s.scheduled_date, 'YYYY-MM-DD') AS scheduled_date,
             s.shift_start, s.shift_end, s.duration_minutes
      FROM shift_trades st
      JOIN shifts s ON s.id = st.shift_id
      JOIN users  fu ON fu.id = st.from_user_id
      LEFT JOIN users tu ON tu.id = st.to_user_id
      ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY st.created_at DESC
      LIMIT 200`;
    const { rows } = await db.query(sql, params);
    ok(res, rows);
  }),
);

adminRouter.post(
  '/shift-trade/:id/decision',
  requirePermission(PERMISSIONS.APPROVE_TRADE),
  validateBody(shiftTradeDecisionSchema),
  asyncHandler(async (req, res) => {
    const db = res.locals.db;
    if (!db || !req.user) throw AppError.unauthorized();
    const tradeId = req.params.id;
    if (!tradeId) throw AppError.validation('trade id required');

    const { rows: existing } = await db.query<{
      shift_id: string;
      to_user_id: string | null;
      status: string;
    }>(`SELECT shift_id, to_user_id, status FROM shift_trades WHERE id = $1`, [tradeId]);
    if (existing.length === 0) throw AppError.notFound('Shift trade');
    const trade = existing[0]!;
    if (trade.status !== 'accepted') {
      // Manager decides only after a worker has accepted; otherwise
      // there's nothing to confirm.
      throw AppError.conflict(`Trade is not awaiting manager decision (status=${trade.status})`);
    }
    if (!trade.to_user_id) {
      throw AppError.conflict('Trade has no accepting worker assigned');
    }

    const newStatus = req.body.decision === 'approved' ? 'approved' : 'rejected';
    const { rows: updated } = await db.query(
      `UPDATE shift_trades
       SET status = $1, decided_by = $2, decided_at = NOW(), updated_at = NOW()
       WHERE id = $3
       RETURNING id, shift_id, from_user_id, to_user_id, status, decided_at`,
      [newStatus, req.user.userId, tradeId],
    );

    // On approval, swap the shift's user. (Rejection: trade closes,
    // shift stays with the original owner.)
    if (newStatus === 'approved') {
      await db.query(`UPDATE shifts SET user_id = $1, updated_at = NOW() WHERE id = $2`, [
        trade.to_user_id,
        trade.shift_id,
      ]);
    }

    ok(res, updated[0]);
  }),
);

// ---- Documents (manager+) ------------------------------------------

adminRouter.get(
  '/documents',
  requirePermission(PERMISSIONS.VIEW_DOCUMENTS_OTHERS),
  asyncHandler(async (req, res) => {
    const db = res.locals.db;
    if (!db) throw AppError.unauthorized();
    const expiringWithin = req.query.expiringWithinDays
      ? Number(req.query.expiringWithinDays)
      : null;
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (expiringWithin !== null && Number.isFinite(expiringWithin)) {
      params.push(expiringWithin);
      conditions.push(
        `d.expires_at IS NOT NULL AND d.expires_at <= CURRENT_DATE + ($${params.length} || ' days')::interval`,
      );
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await db.query(
      `SELECT d.id, d.user_id, d.document_type, d.storage_url,
              to_char(d.expires_at, 'YYYY-MM-DD') AS expires_at,
              d.verified_at, d.verified_by, d.uploaded_at,
              u.email, u.first_name, u.last_name
       FROM employee_documents d
       JOIN users u ON u.id = d.user_id
       ${where}
       ORDER BY (d.expires_at IS NOT NULL) DESC, d.expires_at ASC, d.uploaded_at DESC
       LIMIT 500`,
      params,
    );
    ok(res, rows);
  }),
);

adminRouter.post(
  '/documents/:id/verify',
  requirePermission(PERMISSIONS.VIEW_DOCUMENTS_OTHERS),
  asyncHandler(async (req, res) => {
    const db = res.locals.db;
    if (!db || !req.user) throw AppError.unauthorized();
    const { rows } = await db.query(
      `UPDATE employee_documents
       SET verified_at = NOW(), verified_by = $1
       WHERE id = $2
       RETURNING id, verified_at, verified_by`,
      [req.user.userId, req.params.id],
    );
    if (rows.length === 0) throw AppError.notFound('Document');
    ok(res, rows[0]);
  }),
);

// ---- Cash drawer review (manager+) ---------------------------------

adminRouter.get(
  '/cash-drawer',
  requireRole(ROLES.MANAGER),
  asyncHandler(async (req, res) => {
    const db = res.locals.db;
    if (!db) throw AppError.unauthorized();
    const minVarianceCents = req.query.minVarianceCents ? Number(req.query.minVarianceCents) : null;
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (minVarianceCents !== null && Number.isFinite(minVarianceCents)) {
      params.push(minVarianceCents);
      conditions.push(`ABS(c.variance_cents) >= $${params.length}`);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await db.query(
      `SELECT c.id, c.user_id, c.time_entry_id, c.count_type,
              c.expected_cents, c.counted_cents, c.variance_cents,
              c.notes, c.created_at,
              u.email, u.first_name, u.last_name
       FROM cash_drawer_counts c
       JOIN users u ON u.id = c.user_id
       ${where}
       ORDER BY c.created_at DESC
       LIMIT 200`,
      params,
    );
    ok(res, rows);
  }),
);

// ---- Audit log viewer (owner-only) ---------------------------------

adminRouter.get(
  '/audit-logs',
  requirePermission(PERMISSIONS.VIEW_AUDIT_LOG),
  asyncHandler(async (req, res) => {
    const db = res.locals.db;
    if (!db) throw AppError.unauthorized();
    const from = typeof req.query.from === 'string' ? req.query.from : null;
    const to = typeof req.query.to === 'string' ? req.query.to : null;
    const actorId = typeof req.query.actorId === 'string' ? req.query.actorId : null;
    const action = typeof req.query.action === 'string' ? req.query.action : null;
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (from) {
      params.push(from);
      conditions.push(`a.created_at >= $${params.length}::date`);
    }
    if (to) {
      params.push(to);
      conditions.push(`a.created_at < ($${params.length}::date + INTERVAL '1 day')`);
    }
    if (actorId) {
      params.push(actorId);
      conditions.push(`a.actor_user_id = $${params.length}`);
    }
    if (action) {
      params.push(`%${action}%`);
      conditions.push(`a.action ILIKE $${params.length}`);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await db.query(
      `SELECT a.id, a.actor_user_id, a.resource_type, a.resource_id, a.action,
              a.changes, a.ip_address::text AS ip_address, a.user_agent, a.created_at,
              u.first_name, u.last_name, u.email
       FROM audit_logs a
       LEFT JOIN users u ON u.id = a.actor_user_id
       ${where}
       ORDER BY a.created_at DESC
       LIMIT 500`,
      params,
    );
    ok(res, rows);
  }),
);

// ---- Payroll export (IIF + QBO JSON) -------------------------------

function parseDateRange(req: import('express').Request): { fromDate: string; toDate: string } {
  const from = typeof req.query.from === 'string' ? req.query.from : null;
  const to = typeof req.query.to === 'string' ? req.query.to : null;
  if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    throw AppError.validation('from and to must be YYYY-MM-DD');
  }
  if (to < from) throw AppError.validation('to must be on or after from');
  return { fromDate: from, toDate: to };
}

async function loadOrgForExport(
  db: import('pg').PoolClient,
): Promise<{ timezone: string; accounts: ReturnType<typeof resolveAccounts> }> {
  const { rows } = await db.query<{ timezone: string; qb_chart_of_accounts: unknown }>(
    `SELECT timezone, qb_chart_of_accounts FROM organizations LIMIT 1`,
  );
  const row = rows[0];
  if (!row) throw AppError.notFound('Organization');
  const accounts = resolveAccounts(
    typeof row.qb_chart_of_accounts === 'object' && row.qb_chart_of_accounts !== null
      ? (row.qb_chart_of_accounts as Partial<ReturnType<typeof resolveAccounts>>)
      : null,
  );
  return { timezone: row.timezone ?? 'UTC', accounts };
}

adminRouter.get(
  '/exports/payroll.iif',
  requirePermission(PERMISSIONS.EXPORT_PAYROLL),
  asyncHandler(async (req, res) => {
    const db = res.locals.db;
    if (!db) throw AppError.unauthorized();
    const period = parseDateRange(req);
    const jurisdiction: OvertimeJurisdiction =
      req.query.jurisdiction === 'california' ? 'california' : 'federal';
    const { timezone, accounts } = await loadOrgForExport(db);
    const workers = await loadWorkersForPeriod(db, { period, jurisdiction, orgTimezone: timezone });
    const iif = buildIIF({ workers, period, accounts });
    const filename = `payroll-${period.fromDate}-to-${period.toDate}.iif`;
    res.setHeader('Content-Type', 'application/vnd.intu.iif; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(iif);
  }),
);

adminRouter.get(
  '/exports/payroll.qbo.json',
  requirePermission(PERMISSIONS.EXPORT_PAYROLL),
  asyncHandler(async (req, res) => {
    const db = res.locals.db;
    if (!db) throw AppError.unauthorized();
    const period = parseDateRange(req);
    const jurisdiction: OvertimeJurisdiction =
      req.query.jurisdiction === 'california' ? 'california' : 'federal';
    const { timezone, accounts } = await loadOrgForExport(db);
    const workers = await loadWorkersForPeriod(db, { period, jurisdiction, orgTimezone: timezone });
    const payload = buildQboJson({ workers, period, accounts });
    const filename = `payroll-${period.fromDate}-to-${period.toDate}.qbo.json`;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(JSON.stringify(payload, null, 2));
  }),
);

// ---- Cost-of-labor (Overview widget data) --------------------------

adminRouter.get(
  '/cost-of-labor',
  requireRole(ROLES.MANAGER),
  asyncHandler(async (req, res) => {
    const db = res.locals.db;
    if (!db) throw AppError.unauthorized();
    const period = parseDateRange(req);
    const jurisdiction: OvertimeJurisdiction =
      req.query.jurisdiction === 'california' ? 'california' : 'federal';
    const { timezone } = await loadOrgForExport(db);

    // Actual = sum of estimated pay across active users for the period.
    const workers = await loadWorkersForPeriod(db, { period, jurisdiction, orgTimezone: timezone });
    const actual = workers.reduce((s, w) => s + w.grossPay, 0);

    // Scheduled = SUM(shifts.duration_minutes / 60 * users.pay_rate)
    // for non-time_off, non-cancelled shifts in the date range.
    const { rows: schedRows } = await db.query<{ scheduled_pay: string }>(
      `SELECT COALESCE(SUM((s.duration_minutes / 60.0) * COALESCE(u.pay_rate, 0)), 0)::text
                AS scheduled_pay
       FROM shifts s
       JOIN users u ON u.id = s.user_id
       WHERE s.scheduled_date BETWEEN $1::date AND $2::date
         AND s.status <> 'cancelled'
         AND s.shift_type <> 'time_off'`,
      [period.fromDate, period.toDate],
    );
    const scheduled = Number(schedRows[0]?.scheduled_pay ?? 0);

    // Budget = weekly_labor_budget × weeks-in-range (rounded up).
    const { rows: orgRows } = await db.query<{ weekly_labor_budget: string | null }>(
      `SELECT weekly_labor_budget FROM organizations LIMIT 1`,
    );
    const weeklyBudget = orgRows[0]?.weekly_labor_budget
      ? Number(orgRows[0].weekly_labor_budget)
      : null;
    const days = enumerateDates(period.fromDate, period.toDate).length;
    const weeks = Math.max(1, Math.ceil(days / 7));
    const budget = weeklyBudget !== null ? Number((weeklyBudget * weeks).toFixed(2)) : null;

    ok(res, {
      period,
      scheduled: Number(scheduled.toFixed(2)),
      actual: Number(actual.toFixed(2)),
      budget,
      weeks,
      overBudget: budget !== null && actual > budget,
    });
  }),
);

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
