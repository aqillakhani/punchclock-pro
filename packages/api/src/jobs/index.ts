/**
 * The API's periodic sweeps.
 *
 * Both jobs already existed as CLIs (`db:auto-clock-out`, `db:prune-audit`)
 * and both were documented as "run this on a schedule" — but nothing ever
 * scheduled them. These definitions are that schedule.
 */
import { loadEnv, type AppEnv } from '../config/env.js';
import { runAutoClockOut } from '../services/auto-clock-out.service.js';
import { pruneAuditLogs } from '../db/prune-audit-logs.js';
import type { ScheduledJob } from './scheduler.js';

/**
 * Advisory-lock keys. Arbitrary but must stay stable — changing one lets
 * an old and a new machine run the same sweep concurrently during a
 * rolling deploy.
 */
export const JOB_LOCK_KEYS = {
  autoClockOut: 8_140_001,
  pruneAuditLogs: 8_140_002,
} as const;

/**
 * Build the job list for this environment. Returns an empty list when
 * scheduling is switched off, which is what `startScheduler` expects.
 */
export function scheduledJobs(env: AppEnv = loadEnv()): ScheduledJob[] {
  if (!env.SCHEDULED_JOBS_ENABLED) return [];

  return [
    {
      name: 'auto-clock-out',
      lockKey: JOB_LOCK_KEYS.autoClockOut,
      intervalMs: env.AUTO_CLOCK_OUT_INTERVAL_MINUTES * 60_000,
      // The close time is derived from punch_in + the org's cap, not from
      // when the sweep runs, so a late pass produces the same rows as a
      // punctual one. Hourly is plenty.
      run: (db) => runAutoClockOut(db),
    },
    {
      name: 'prune-audit-logs',
      lockKey: JOB_LOCK_KEYS.pruneAuditLogs,
      intervalMs: env.AUDIT_LOG_PRUNE_INTERVAL_MINUTES * 60_000,
      run: (db) => pruneAuditLogs(db),
    },
  ];
}
