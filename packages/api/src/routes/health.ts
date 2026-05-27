import { Router } from 'express';
import { getPool } from '../config/database.js';
import { pingRedis } from '../config/redis.js';
import { loadEnv } from '../config/env.js';
import { ok } from '../lib/response.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { assembleHealth, healthHttpStatus, type ProbeState } from './health.logic.js';

export interface HealthDeps {
  getVersion: () => string;
  probeDb: () => Promise<ProbeState>;
  probeRedis: () => Promise<ProbeState>;
}

async function defaultProbeDb(): Promise<ProbeState> {
  try {
    const result = await getPool().query('SELECT 1 AS ok');
    return result.rows[0]?.ok === 1 ? 'up' : 'down';
  } catch {
    return 'down';
  }
}

const defaultDeps: HealthDeps = {
  getVersion: () => loadEnv().APP_VERSION,
  probeDb: defaultProbeDb,
  probeRedis: async () => ((await pingRedis()) ? 'up' : 'down'),
};

/**
 * Health routes. `buildHealthRouter` takes injectable probes so the HTTP
 * behavior (status codes, body shape) can be unit-tested without a live
 * database or Redis.
 *
 *   GET /health        — full report {status, version, db, redis}; 503 if db down
 *   GET /health/live   — liveness: 200 as long as the process is up
 *   GET /health/ready  — readiness: 200 iff the database is reachable, else 503
 */
export function buildHealthRouter(deps: HealthDeps = defaultDeps): Router {
  const router = Router();

  router.get('/live', (_req, res) => ok(res, { status: 'ok' }));

  router.get(
    '/ready',
    asyncHandler(async (_req, res) => {
      const db = await deps.probeDb();
      const up = db === 'up';
      res.status(up ? 200 : 503).json({ success: up, data: { status: up ? 'ok' : 'down', db } });
    }),
  );

  router.get(
    '/',
    asyncHandler(async (_req, res) => {
      const [db, redis] = await Promise.all([deps.probeDb(), deps.probeRedis()]);
      const report = assembleHealth({ version: deps.getVersion(), db, redis });
      res
        .status(healthHttpStatus(report))
        .json({ success: report.status !== 'error', data: report });
    }),
  );

  return router;
}

export const healthRouter = buildHealthRouter();
