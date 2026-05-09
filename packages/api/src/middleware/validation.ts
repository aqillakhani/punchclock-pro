import type { RequestHandler } from 'express';
import type { ZodSchema } from 'zod';

/**
 * Validate `req.body` against a Zod schema and replace it with the parsed
 * value. Zod errors are handled by the global error handler.
 */
export function validateBody<T>(schema: ZodSchema<T>): RequestHandler {
  return (req, _res, next) => {
    const parsed = schema.parse(req.body);
    req.body = parsed;
    next();
  };
}

export function validateQuery<T>(schema: ZodSchema<T>): RequestHandler {
  return (req, _res, next) => {
    const parsed = schema.parse(req.query);
    (req as unknown as { validatedQuery: T }).validatedQuery = parsed;
    next();
  };
}
