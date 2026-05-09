import { ERROR_CODES, HTTP_STATUS } from '@punchclock/shared';

export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }

  static unauthorized(message = 'Unauthorized'): AppError {
    return new AppError(ERROR_CODES.UNAUTHORIZED, message, HTTP_STATUS.UNAUTHORIZED);
  }

  static forbidden(message = 'Forbidden'): AppError {
    return new AppError(ERROR_CODES.FORBIDDEN, message, HTTP_STATUS.FORBIDDEN);
  }

  static notFound(resource = 'Resource'): AppError {
    return new AppError(ERROR_CODES.NOT_FOUND, `${resource} not found`, HTTP_STATUS.NOT_FOUND);
  }

  static conflict(message: string, code: string = ERROR_CODES.CONFLICT): AppError {
    return new AppError(code, message, HTTP_STATUS.CONFLICT);
  }

  static validation(message: string, details?: unknown): AppError {
    return new AppError(
      ERROR_CODES.VALIDATION,
      message,
      HTTP_STATUS.UNPROCESSABLE_ENTITY,
      details,
    );
  }

  static alreadyClockedIn(): AppError {
    return new AppError(
      ERROR_CODES.ALREADY_CLOCKED_IN,
      'User is already clocked in',
      HTTP_STATUS.CONFLICT,
    );
  }

  static notClockedIn(): AppError {
    return new AppError(
      ERROR_CODES.NOT_CLOCKED_IN,
      'User is not currently clocked in',
      HTTP_STATUS.CONFLICT,
    );
  }

  static geofenceViolation(details?: unknown): AppError {
    return new AppError(
      ERROR_CODES.GEOFENCE_VIOLATION,
      'Punch rejected by geofence policy',
      HTTP_STATUS.FORBIDDEN,
      details,
    );
  }
}
