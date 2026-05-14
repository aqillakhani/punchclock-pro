import type { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import {
  ROLE_HIERARCHY,
  can,
  type Action,
  type AuthenticatedUser,
  type Role,
} from '@punchclock/shared';
import { AppError } from '../lib/errors.js';
import { loadEnv } from '../config/env.js';

interface JwtPayload {
  sub: string;
  org_id: string;
  role: Role;
  email: string;
  iat?: number;
  exp?: number;
}

export function signAppJwt(user: AuthenticatedUser): string {
  const env = loadEnv();
  return jwt.sign(
    {
      sub: user.userId,
      org_id: user.organizationId,
      role: user.role,
      email: user.email,
    } satisfies Omit<JwtPayload, 'iat' | 'exp'>,
    env.JWT_SECRET,
    { expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'] },
  );
}

export function verifyAppJwt(token: string): AuthenticatedUser {
  const env = loadEnv();
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET) as JwtPayload;
    return {
      userId: decoded.sub,
      organizationId: decoded.org_id,
      role: decoded.role,
      email: decoded.email,
    };
  } catch {
    throw AppError.unauthorized('Invalid or expired token');
  }
}

/**
 * Require a valid JWT on the request. Extracts from the Authorization
 * header (`Bearer <token>`) or the `pc_token` cookie.
 *
 * Owners may also send `X-Preview-As-User-Id: <uuid>` to render the
 * dashboard as that user — every request runs with the previewed
 * identity (role + userId), but only when the *real* JWT belongs to
 * an owner. The substitution happens in `withTenantDb` because that's
 * where we have a database connection to look up the previewed user;
 * here we just stash the request to honor.
 */
export function requireAuth(): RequestHandler {
  return (req, _res, next) => {
    const header = req.headers.authorization;
    let token: string | undefined;
    if (header?.startsWith('Bearer ')) {
      token = header.slice('Bearer '.length);
    } else if (typeof req.headers['x-pc-token'] === 'string') {
      token = req.headers['x-pc-token'];
    }
    if (!token) throw AppError.unauthorized('Missing authentication token');
    req.user = verifyAppJwt(token);

    const previewHeader = req.headers['x-preview-as-user-id'];
    if (typeof previewHeader === 'string' && previewHeader.length > 0) {
      // Only owners may impersonate; others get the header silently
      // ignored (don't leak whether the id exists).
      if (req.user.role === 'owner' && previewHeader !== req.user.userId) {
        (req as unknown as { previewAsUserId?: string }).previewAsUserId = previewHeader;
      }
    }
    next();
  };
}

/**
 * Require the authenticated user to have at least the given role.
 * Roles are hierarchical (owner > manager > employee > viewer).
 *
 * Prefer {@link requirePermission} for new routes — it consults the
 * shared RBAC matrix instead of relying on hierarchy alone, so
 * special-case grants (e.g. viewer can `view:reports`) work correctly.
 */
export function requireRole(min: Role): RequestHandler {
  const minLevel = ROLE_HIERARCHY[min];
  return (req, _res, next) => {
    if (!req.user) throw AppError.unauthorized();
    if (ROLE_HIERARCHY[req.user.role] < minLevel) {
      throw AppError.forbidden(`Requires role >= ${min}`);
    }
    next();
  };
}

/**
 * Require the authenticated user's role to be granted the given
 * action by the shared permissions matrix
 * (`@punchclock/shared/permissions`).
 *
 * This supersedes {@link requireRole} for routes whose access pattern
 * is not strictly hierarchical — for example, viewers can read
 * timesheets even though `viewer < employee` in the hierarchy.
 */
export function requirePermission(action: Action): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) throw AppError.unauthorized();
    if (!can(req.user.role, action)) {
      throw AppError.forbidden(`Missing permission: ${action}`);
    }
    next();
  };
}
