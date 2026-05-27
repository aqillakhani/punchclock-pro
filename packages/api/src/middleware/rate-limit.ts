import rateLimit, { type RateLimitRequestHandler } from 'express-rate-limit';
import type { Request } from 'express';

/**
 * Rate limiting for abuse-prone endpoints.
 *
 * Uses express-rate-limit's in-memory store, which is correct and robust for
 * a single API instance (the target deployment). It deliberately avoids a
 * Redis-backed store: a Redis outage with a Redis store would make /auth/login
 * return 500s — locking everyone out — which is a worse failure than a counter
 * that resets on restart. To scale past one instance, pass a `rate-limit-redis`
 * store (backed by `getRedis()`) into `createRateLimiter`.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export function ipKey(req: Request): string {
  return `ip:${req.ip ?? 'unknown'}`;
}

/** Key by the authenticated user when present, else by client IP. */
export function userOrIpKey(req: Request): string {
  const userId = (req as Request & { user?: { userId?: string } }).user?.userId;
  return userId ? `user:${userId}` : ipKey(req);
}

export interface RateLimiterConfig {
  windowMs: number;
  limit: number;
  message: string;
  keyGenerator?: (req: Request) => string;
}

export function createRateLimiter(config: RateLimiterConfig): RateLimitRequestHandler {
  return rateLimit({
    windowMs: config.windowMs,
    limit: config.limit,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: config.keyGenerator ?? ipKey,
    handler: (_req, res) => {
      res.status(429).json({
        success: false,
        error: { code: 'RATE_LIMITED', message: config.message },
      });
    },
  });
}

/** 10 login attempts per minute per IP — blunts credential stuffing. */
export const loginRateLimiter = (): RateLimitRequestHandler =>
  createRateLimiter({
    windowMs: MINUTE,
    limit: 10,
    message: 'Too many login attempts — wait a minute and try again.',
  });

/** A handful of bootstrap-signup attempts per hour per IP. */
export const signupRateLimiter = (): RateLimitRequestHandler =>
  createRateLimiter({
    windowMs: HOUR,
    limit: 5,
    message: 'Too many signup attempts from this address — try again later.',
  });

/** 5 PIN changes per minute per user — stops PIN brute-forcing via reset. */
export const pinRateLimiter = (): RateLimitRequestHandler =>
  createRateLimiter({
    windowMs: MINUTE,
    limit: 5,
    keyGenerator: userOrIpKey,
    message: 'Too many PIN updates — wait a minute and try again.',
  });

/** 5 forgot/reset-password requests per 15 min per IP. */
export const passwordResetRateLimiter = (): RateLimitRequestHandler =>
  createRateLimiter({
    windowMs: 15 * MINUTE,
    limit: 5,
    message: 'Too many password reset attempts — wait a few minutes and try again.',
  });
