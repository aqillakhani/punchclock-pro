import { Router } from 'express';
import bcrypt from 'bcrypt';
import { loginRequestSchema, signupRequestSchema } from '@punchclock/shared';
import { withTenantTx } from '../config/database.js';
import { loadEnv } from '../config/env.js';
import { requireAuth, signAppJwt } from '../middleware/auth.js';
import { withTenantDb } from '../middleware/tenant.js';
import { validateBody } from '../middleware/validation.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { created, ok } from '../lib/response.js';
import { AppError } from '../lib/errors.js';

export const authRouter = Router();

/**
 * Bootstrap signup. Only succeeds when zero organizations exist — used to
 * create the first owner on a fresh install. After that, /signup returns
 * 403 and new users must be created by an existing owner via POST
 * /api/v1/admin/users.
 */
authRouter.post(
  '/signup',
  validateBody(signupRequestSchema),
  asyncHandler(async (req, res) => {
    const env = loadEnv();
    const passwordHash = await bcrypt.hash(req.body.ownerPassword, env.BCRYPT_ROUNDS);
    const slug = req.body.organizationName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 64);

    const result = await withTenantTx(null, async (client) => {
      const existing = await client.query<{ count: string }>(
        'SELECT COUNT(*)::text AS count FROM organizations WHERE deleted_at IS NULL',
      );
      if (Number(existing.rows[0]?.count ?? '0') > 0) {
        throw AppError.forbidden(
          'Bootstrap signup is only available before any organization exists',
        );
      }

      const orgRes = await client.query<{ id: string }>(
        `INSERT INTO organizations (name, slug, timezone, industry)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [
          req.body.organizationName,
          `${slug}-${Date.now()}`,
          req.body.timezone,
          req.body.industry ?? null,
        ],
      );
      const organizationId = orgRes.rows[0]!.id;

      const userRes = await client.query<{ id: string; email: string }>(
        `INSERT INTO users (organization_id, email, first_name, last_name, password_hash, role)
         VALUES ($1, $2, $3, $4, $5, 'owner') RETURNING id, email`,
        [
          organizationId,
          req.body.ownerEmail,
          req.body.ownerFirstName ?? null,
          req.body.ownerLastName ?? null,
          passwordHash,
        ],
      );

      return { organizationId, userId: userRes.rows[0]!.id, email: userRes.rows[0]!.email };
    });

    const token = signAppJwt({
      userId: result.userId,
      organizationId: result.organizationId,
      role: 'owner',
      email: result.email,
    });
    created(res, { token, organizationId: result.organizationId, userId: result.userId });
  }),
);

authRouter.post(
  '/login',
  validateBody(loginRequestSchema),
  asyncHandler(async (req, res) => {
    const row = await withTenantTx(null, async (client) => {
      const { rows } = await client.query<{
        id: string;
        organization_id: string;
        email: string;
        role: 'owner' | 'manager' | 'employee' | 'viewer';
        password_hash: string | null;
        status: 'active' | 'inactive' | 'archived';
      }>(
        `SELECT id, organization_id, email, role, password_hash, status
         FROM users
         WHERE email = $1 AND deleted_at IS NULL
         LIMIT 1`,
        [req.body.email],
      );
      return rows[0] ?? null;
    });

    if (!row || row.status !== 'active' || !row.password_hash) {
      throw AppError.unauthorized('Invalid email or password');
    }
    const match = await bcrypt.compare(req.body.password, row.password_hash);
    if (!match) throw AppError.unauthorized('Invalid email or password');

    await withTenantTx(null, async (client) => {
      await client.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [row.id]);
    });

    const token = signAppJwt({
      userId: row.id,
      organizationId: row.organization_id,
      role: row.role,
      email: row.email,
    });
    ok(res, { token, organizationId: row.organization_id, userId: row.id, role: row.role });
  }),
);

authRouter.get(
  '/me',
  requireAuth(),
  withTenantDb(),
  asyncHandler(async (req, res) => {
    const db = res.locals.db;
    if (!db || !req.user) throw AppError.unauthorized();
    const { rows } = await db.query(
      `SELECT u.id, u.email, u.first_name, u.last_name, u.role, u.pay_rate,
              u.worker_type, u.worksite, u.pay_currency, u.job_title,
              o.id AS organization_id, o.name AS organization_name, o.timezone,
              o.fx_rates
       FROM users u JOIN organizations o ON o.id = u.organization_id
       WHERE u.id = $1`,
      [req.user.userId],
    );
    if (rows.length === 0) throw AppError.notFound('User');
    ok(res, rows[0]);
  }),
);
