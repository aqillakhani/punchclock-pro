/**
 * Pure health-report assembly — no I/O, no env, no heavy imports — so it
 * can be unit-tested in isolation. The route layer (`health.ts`) supplies
 * the actual probe results.
 */
import type { RedisState } from '../config/redis.logic.js';

export type ProbeState = 'up' | 'down';
/** Re-exported so consumers of the report get its full shape from one module. */
export type { RedisState };
export type HealthStatus = 'ok' | 'degraded' | 'error';

export interface HealthReport {
  status: HealthStatus;
  version: string;
  db: ProbeState;
  redis: RedisState;
}

/**
 * The database is critical: if it's down the service is in `error`.
 *
 * Redis is optional. 'disabled' means the deployment deliberately runs without
 * it (single instance, in-memory Socket.io adapter) — a supported, healthy
 * configuration, so it maps to `ok`. Only 'down' — configured but unreachable —
 * is `degraded`, because then cross-instance broadcast is silently broken.
 */
export function assembleHealth(opts: {
  version: string;
  db: ProbeState;
  redis: RedisState;
}): HealthReport {
  const status: HealthStatus =
    opts.db === 'down' ? 'error' : opts.redis === 'down' ? 'degraded' : 'ok';
  return { status, version: opts.version, db: opts.db, redis: opts.redis };
}

/** 503 when the service can't serve requests (db down); 200 otherwise. */
export function healthHttpStatus(report: HealthReport): number {
  return report.status === 'error' ? 503 : 200;
}
