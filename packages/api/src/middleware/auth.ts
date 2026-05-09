import type { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { ROLE_HIERARCHY, type AuthenticatedUser, type Role } from '@punchclock/shared';
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
    next();
  };
}

/**
 * Require the authenticated user to have at least the given role.
 * Roles are hierarchical (owner > manager > employee > viewer).
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
