import { Router } from 'express';
import bcrypt from 'bcrypt';
import { PERMISSIONS, ROLES, inviteUserSchema, organizationUpdateSchema } from '@punchclock/shared';
import { loadEnv } from '../config/env.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { withTenantDb } from '../middleware/tenant.js';
import { validateBody } from '../middleware/validation.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { created, noContent, ok } from '../lib/response.js';
import { AppError } from '../lib/errors.js';
import { calculateOvertime, type OvertimeJurisdiction } from '../services/overtime.service.js';

export const adminRouter = Router();

adminRouter.use(requireAuth(), withTenantDb());

adminRouter.get(
  '/organization',
  asyncHandler(async (_req, res) => {
    const db = res.locals.db;
    if (!db) throw AppError.unauthorized();
    const { rows } = await db.query(
      `SELECT id, name, slug, timezone, industry,
              geofencing_enabled, break_tracking_enabled, created_at
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
    const mapping: Record<string, string> = {
      name: 'name',
      timezone: 'timezone',
      geofencingEnabled: 'geofencing_enabled',
      breakTrackingEnabled: 'break_tracking_enabled',
    };
    for (const [key, column] of Object.entries(mapping)) {
      if (key in req.body) {
        values.push(req.body[key]);
        fields.push(`${column} = $${values.length}`);
      }
    }
    if (fields.length === 0) throw AppError.validation('No updatable fields');
    values.push(req.user.organizationId);
    const { rows } = await db.query(
      `UPDATE organizations SET ${fields.join(', ')}, updated_at = NOW()
       WHERE id = $${values.length}
       RETURNING id, name, slug, timezone, geofencing_enabled, break_tracking_enabled`,
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
    const passwordHash = await bcrypt.hash(req.body.password, env.BCRYPT_ROUNDS);

    const { rows } = await db.query(
      `INSERT INTO users
         (organization_id, email, first_name, last_name, password_hash, role, pay_rate, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'active')
       RETURNING id, email, first_name, last_name, role, status`,
      [
        req.user.organizationId,
        req.body.email,
        req.body.firstName ?? null,
        req.body.lastName ?? null,
        passwordHash,
        req.body.role,
        req.body.payRate ?? null,
      ],
    );
    created(res, rows[0]);
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
