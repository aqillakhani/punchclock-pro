import type { Response, RequestHandler } from 'express';
import { getPool } from '../config/database.js';
import { AppError } from '../lib/errors.js';

/**
 * Acquire a per-request pg client, set the RLS tenant GUC, and run
 * the handler inside a transaction. The transaction is committed
 * (or rolled back, on 4xx/5xx) *before* the response is flushed to
 * the client — so a follow-up request from the same client always
 * sees the writes it just observed.
 *
 * Handlers attach the client to `res.locals.db` and send their
 * response via the standard `ok`/`created`/`noContent` helpers; the
 * middleware patches `res.json`/`res.send` to interpose the
 * COMMIT/ROLLBACK before the bytes go out the door.
 */
export function withTenantDb(): RequestHandler {
  return (req, res, next) => {
    if (!req.user) {
      next(AppError.unauthorized());
      return;
    }
    const orgId = req.user.organizationId;
    getPool()
      .connect()
      .then(async (client) => {
        try {
          await client.query('BEGIN');
          await client.query("SELECT set_config('app.current_org_id', $1, true)", [orgId]);
          res.locals.db = client;

          let finalized = false;
          const finalize = async (rollback: boolean): Promise<void> => {
            if (finalized) return;
            finalized = true;
            try {
              await client.query(rollback ? 'ROLLBACK' : 'COMMIT');
            } finally {
              client.release();
            }
          };

          // Patch res.json and res.send so the commit lands before the
          // response is flushed. Both helpers used by `ok`/`created`/
          // `noContent` route into one of these two.
          const origJson = res.json.bind(res);
          res.json = function patchedJson(body: unknown): Response {
            finalize(res.statusCode >= 400)
              .then(() => origJson(body))
              .catch((err) => next(err));
            return res;
          };

          const origSend = res.send.bind(res);
          res.send = function patchedSend(body?: unknown): Response {
            finalize(res.statusCode >= 400)
              .then(() => origSend(body))
              .catch((err) => next(err));
            return res;
          };

          // Belt-and-suspenders: if the socket closes without either
          // helper firing (rare — typically a client disconnect), make
          // sure we still rollback and return the client.
          res.once('close', () => {
            if (!finalized) {
              finalize(true).catch(() => undefined);
            }
          });

          next();
        } catch (err) {
          client.release();
          next(err);
        }
      })
      .catch((err) => next(err));
  };
}
