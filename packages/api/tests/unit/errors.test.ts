import { describe, it, expect } from '@jest/globals';
import { AppError } from '../../src/lib/errors.js';
import { ERROR_CODES, HTTP_STATUS } from '@punchclock/shared';

describe('AppError factory helpers', () => {
  it('produces a 401 for unauthorized', () => {
    const e = AppError.unauthorized();
    expect(e.statusCode).toBe(HTTP_STATUS.UNAUTHORIZED);
    expect(e.code).toBe(ERROR_CODES.UNAUTHORIZED);
  });

  it('produces a 403 for forbidden', () => {
    const e = AppError.forbidden();
    expect(e.statusCode).toBe(HTTP_STATUS.FORBIDDEN);
  });

  it('produces a 404 for notFound with a resource name', () => {
    const e = AppError.notFound('Geofence');
    expect(e.statusCode).toBe(HTTP_STATUS.NOT_FOUND);
    expect(e.message).toBe('Geofence not found');
  });

  it('produces a 409 for alreadyClockedIn with the right code', () => {
    const e = AppError.alreadyClockedIn();
    expect(e.statusCode).toBe(HTTP_STATUS.CONFLICT);
    expect(e.code).toBe(ERROR_CODES.ALREADY_CLOCKED_IN);
  });

  it('produces a 403 for geofenceViolation with details', () => {
    const e = AppError.geofenceViolation({ distanceMeters: 250 });
    expect(e.statusCode).toBe(HTTP_STATUS.FORBIDDEN);
    expect(e.code).toBe(ERROR_CODES.GEOFENCE_VIOLATION);
    expect(e.details).toEqual({ distanceMeters: 250 });
  });
});
