import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { ERROR_CODES, HTTP_STATUS, type ApiFailure } from '@punchclock/shared';
import { AppError } from '../lib/errors.js';
import { logger } from '../config/logger.js';

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    const body: ApiFailure = {
      success: false,
      error: { code: err.code, message: err.message, details: err.details },
    };
    res.status(err.statusCode).json(body);
    return;
  }

  if (err instanceof ZodError) {
    const body: ApiFailure = {
      success: false,
      error: {
        code: ERROR_CODES.VALIDATION,
        message: 'Request validation failed',
        details: err.flatten(),
      },
    };
    res.status(HTTP_STATUS.UNPROCESSABLE_ENTITY).json(body);
    return;
  }

  logger.error({ err }, 'unhandled error');
  const body: ApiFailure = {
    success: false,
    error: { code: ERROR_CODES.INTERNAL, message: 'Internal server error' },
  };
  res.status(HTTP_STATUS.INTERNAL_ERROR).json(body);
};

export function notFoundHandler(): import('express').RequestHandler {
  return (_req, _res, next) => next(AppError.notFound('Route'));
}
