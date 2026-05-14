import { describe, it, expect, jest } from '@jest/globals';
import type { Request, Response, NextFunction } from 'express';
import { ERROR_CODES, HTTP_STATUS, PERMISSIONS } from '@punchclock/shared';
import { requirePermission, requireRole } from '../../src/middleware/auth.js';
import { AppError } from '../../src/lib/errors.js';

function makeReq(role: 'owner' | 'manager' | 'employee' | 'viewer' | undefined): Request {
  return {
    user: role
      ? {
          userId: 'u1',
          organizationId: 'org1',
          role,
          email: 'u@test',
        }
      : undefined,
  } as unknown as Request;
}

function callMiddleware(
  middleware: ReturnType<typeof requirePermission>,
  req: Request,
): { error: unknown | null; called: boolean } {
  const next = jest.fn() as unknown as NextFunction;
  const res = {} as Response;
  let error: unknown = null;
  try {
    middleware(req, res, next);
  } catch (err) {
    error = err;
  }
  return {
    error,
    called: (next as unknown as { mock: { calls: unknown[] } }).mock.calls.length > 0,
  };
}

describe('requirePermission middleware', () => {
  it('passes when the role has the action', () => {
    const mw = requirePermission(PERMISSIONS.EDIT_SCHEDULE);
    const result = callMiddleware(mw, makeReq('manager'));
    expect(result.error).toBeNull();
    expect(result.called).toBe(true);
  });

  it('throws 403 when the role lacks the action', () => {
    const mw = requirePermission(PERMISSIONS.EDIT_SETTINGS);
    const result = callMiddleware(mw, makeReq('manager'));
    expect(result.error).toBeInstanceOf(AppError);
    const err = result.error as AppError;
    expect(err.statusCode).toBe(HTTP_STATUS.FORBIDDEN);
    expect(err.code).toBe(ERROR_CODES.FORBIDDEN);
    expect(err.message).toContain('edit:settings');
    expect(result.called).toBe(false);
  });

  it('throws 401 when the request has no authenticated user', () => {
    const mw = requirePermission(PERMISSIONS.PUNCH_CLOCK);
    const result = callMiddleware(mw, makeReq(undefined));
    expect(result.error).toBeInstanceOf(AppError);
    const err = result.error as AppError;
    expect(err.statusCode).toBe(HTTP_STATUS.UNAUTHORIZED);
    expect(result.called).toBe(false);
  });

  it('grants viewer access to view:reports even though viewer < employee', () => {
    // The case requirePermission was invented for: hierarchy alone
    // would have blocked viewer from reading reports.
    const mw = requirePermission(PERMISSIONS.VIEW_REPORTS);
    const result = callMiddleware(mw, makeReq('viewer'));
    expect(result.error).toBeNull();
    expect(result.called).toBe(true);
  });

  it('blocks employee from view:reports', () => {
    const mw = requirePermission(PERMISSIONS.VIEW_REPORTS);
    const result = callMiddleware(mw, makeReq('employee'));
    expect(result.error).toBeInstanceOf(AppError);
    expect((result.error as AppError).statusCode).toBe(HTTP_STATUS.FORBIDDEN);
  });
});

describe('requireRole middleware (still used by legacy routes)', () => {
  it('passes when the role meets the minimum', () => {
    const mw = requireRole('manager');
    const result = callMiddleware(mw, makeReq('owner'));
    expect(result.error).toBeNull();
    expect(result.called).toBe(true);
  });

  it('throws 403 when below the minimum', () => {
    const mw = requireRole('manager');
    const result = callMiddleware(mw, makeReq('employee'));
    expect(result.error).toBeInstanceOf(AppError);
    expect((result.error as AppError).statusCode).toBe(HTTP_STATUS.FORBIDDEN);
  });
});
