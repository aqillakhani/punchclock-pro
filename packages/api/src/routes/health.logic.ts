/**
 * Pure health-report assembly — no I/O, no env, no heavy imports — so it
 * can be unit-tested in isolation. The route layer (`health.ts`) supplies
 * the actual probe results.
 */
export type ProbeState = 'up' | 'down';
export type HealthStatus = 'ok' | 'degraded' | 'error';

export interface HealthReport {
  status: HealthStatus;
  version: string;
  db: ProbeState;
  redis: ProbeState;
}

/**
 * The database is critical: if it's down the service is in `error`. Redis is
 * non-critical for a single instance (it backs cross-instance broadcast +
 * shared rate-limit buckets), so a redis outage is only `degraded`.
 */
export function assembleHealth(opts: {
  version: string;
  db: ProbeState;
  redis: ProbeState;
}): HealthReport {
  const status: HealthStatus =
    opts.db === 'down' ? 'error' : opts.redis === 'down' ? 'degraded' : 'ok';
  return { status, version: opts.version, db: opts.db, redis: opts.redis };
}

/** 503 when the service can't serve requests (db down); 200 otherwise. */
export function healthHttpStatus(report: HealthReport): number {
  return report.status === 'error' ? 503 : 200;
}
