import type { RequestHandler } from 'express';
import { withTenantTx } from '../config/database.js';
import { AppError } from '../lib/errors.js';

/**
 * Run the handler inside a database transaction with RLS context set
 * from the authenticated user's organization_id. The `pg` client is
 * attached to `res.locals.db` for downstream handlers to use.
 *
 * Because Express handlers don't natively support wrapping in an async
 * scope, we acquire the client via a helper that all route code should
 * use instead of the raw pool. Handlers MUST call `res.locals.db`.
 */
export function withTenantDb(): RequestHandler {
  return (req, res, next) => {
    if (!req.user) {
      next(AppError.unauthorized());
      return;
    }
    const orgId = req.user.organizationId;
    withTenantTx(orgId, async (client) => {
      res.locals.db = client;
      return new Promise<void>((resolve, reject) => {
        // Once the response finishes, we resolve so the transaction commits.
        res.once('finish', () => {
          if (res.statusCode >= 400) {
            reject(new Error(`rollback due to status ${res.statusCode}`));
          } else {
            resolve();
          }
        });
        res.once('close', () => resolve());
        next();
      });
    }).catch((err) => {
      // If the response already went out we can't forward the error.
      if (!res.headersSent) next(err);
    });
  };
}
