import { Router } from 'express';
import bcrypt from 'bcrypt';
import { ROLES, inviteUserSchema, organizationUpdateSchema } from '@punchclock/shared';
import { loadEnv } from '../config/env.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { withTenantDb } from '../middleware/tenant.js';
import { validateBody } from '../middleware/validation.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { created, noContent, ok } from '../lib/response.js';
import { AppError } from '../lib/errors.js';

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
  requireRole(ROLES.OWNER),
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
  requireRole(ROLES.MANAGER),
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

adminRouter.post(
  '/users',
  requireRole(ROLES.OWNER),
  validateBody(inviteUserSchema),
  asyncHandler(async (req, res) => {
    const db = res.locals.db;
    if (!db || !req.user) throw AppError.unauthorized();

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
  requireRole(ROLES.OWNER),
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
