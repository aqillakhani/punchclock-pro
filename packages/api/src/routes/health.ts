import { Router } from 'express';
import { getPool } from '../config/database.js';
import { ok } from '../lib/response.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

export const healthRouter = Router();

healthRouter.get('/live', (_req, res) => ok(res, { status: 'ok' }));

healthRouter.get(
  '/ready',
  asyncHandler(async (_req, res) => {
    const result = await getPool().query('SELECT 1 AS ok');
    ok(res, { status: 'ok', db: result.rows[0]?.ok === 1 ? 'up' : 'down' });
  }),
);
