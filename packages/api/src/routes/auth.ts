import { Router } from 'express';
import bcrypt from 'bcrypt';
import {
  forgotPasswordSchema,
  loginRequestSchema,
  resetPasswordSchema,
  signupRequestSchema,
  type ForgotPasswordInput,
  type ResetPasswordInput,
} from '@punchclock/shared';
import { withTenantTx } from '../config/database.js';
import { loadEnv } from '../config/env.js';
import { requireAuth, signAppJwt } from '../middleware/auth.js';
import { withTenantDb } from '../middleware/tenant.js';
import { validateBody } from '../middleware/validation.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import {
  loginRateLimiter,
  passwordResetRateLimiter,
  signupRateLimiter,
} from '../middleware/rate-limit.js';
import {
  applyPasswordReset,
  findActiveUserByEmail,
  findResetTokenByHash,
  generateResetToken,
  hashToken,
  isTokenUsable,
  resetTokenExpiry,
  storeResetToken,
} from '../services/password-reset.service.js';
import { passwordResetEmail, sendEmail } from '../services/email.service.js';
import { created, ok } from '../lib/response.js';
import { AppError } from '../lib/errors.js';

export const authRouter = Router();

// One limiter instance each (their counters live in the instance's store).
const loginLimiter = loginRateLimiter();
const signupLimiter = signupRateLimiter();
const passwordResetLimiter = passwordResetRateLimiter();

/**
 * Bootstrap signup. Only succeeds when zero organizations exist — used to
 * create the first owner on a fresh install. After that, /signup returns
 * 403 and new users must be created by an existing owner via POST
 * /api/v1/admin/users.
 */
authRouter.post(
  '/signup',
  signupLimiter,
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
  loginLimiter,
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

/**
 * Request a password reset. Always responds 200 with the same message
 * whether or not the email exists — never reveal which addresses are
 * registered. A valid, active user is emailed a single-use, 15-minute link.
 */
authRouter.post(
  '/forgot-password',
  passwordResetLimiter,
  validateBody(forgotPasswordSchema),
  asyncHandler(async (req, res) => {
    const env = loadEnv();
    const { email } = req.body as ForgotPasswordInput;

    const user = await withTenantTx(null, (client) => findActiveUserByEmail(client, email));
    if (user) {
      const rawToken = generateResetToken();
      await withTenantTx(null, (client) =>
        storeResetToken(client, {
          organizationId: user.organization_id,
          userId: user.id,
          tokenHash: hashToken(rawToken),
          expiresAt: resetTokenExpiry(new Date()),
        }),
      );
      const resetUrl = `${env.WEB_APP_URL}/reset-password?token=${encodeURIComponent(rawToken)}`;
      await sendEmail({
        ...passwordResetEmail({ resetUrl, firstName: user.first_name ?? undefined }),
        to: user.email,
      });
    }

    ok(res, { message: 'If that email is registered, a reset link is on its way.' });
  }),
);

/**
 * Complete a password reset (also used for invite setup — same token table).
 * Verifies the single-use token, hashes the new password, and consumes the
 * token. Returns a generic error on any invalid/expired/used token.
 */
authRouter.post(
  '/reset-password',
  passwordResetLimiter,
  validateBody(resetPasswordSchema),
  asyncHandler(async (req, res) => {
    const env = loadEnv();
    const { token, password } = req.body as ResetPasswordInput;
    const tokenHash = hashToken(token);
    const now = new Date();

    const reset = await withTenantTx(null, async (client) => {
      const row = await findResetTokenByHash(client, tokenHash);
      if (!row || !isTokenUsable(row, now)) return false;
      const passwordHash = await bcrypt.hash(password, env.BCRYPT_ROUNDS);
      await applyPasswordReset(client, {
        tokenId: row.id,
        userId: row.user_id,
        passwordHash,
      });
      return true;
    });

    if (!reset) {
      throw AppError.validation('This reset link is invalid or has expired. Request a new one.');
    }
    ok(res, { message: 'Your password has been reset. You can now sign in.' });
  }),
);
