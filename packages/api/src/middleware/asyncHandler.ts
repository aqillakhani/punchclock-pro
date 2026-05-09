import type { Request, Response, NextFunction, RequestHandler } from 'express';

/**
 * Wrap an async route handler so thrown errors propagate to the
 * Express error-handling middleware. Without this, async rejections
 * become silent hangs.
 */
export function asyncHandler<
  Req extends Request = Request,
  Res extends Response = Response,
>(fn: (req: Req, res: Res, next: NextFunction) => Promise<unknown>): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req as Req, res as Res, next)).catch(next);
  };
}
