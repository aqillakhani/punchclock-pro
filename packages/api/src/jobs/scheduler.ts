/**
 * In-process scheduler for the API's periodic sweeps.
 *
 * Why in-process rather than a Fly scheduled machine or a cron container:
 * the schedule then lives in version control and ships with the code that
 * needs it. An out-of-band `fly machine run` is invisible in the repo, is
 * silently lost on app recreation, and has to be remembered by whoever
 * deploys — which is exactly how audit-log pruning ended up documented
 * but never actually running.
 *
 * Correctness under more than one machine is handled by a Postgres
 * advisory lock rather than by assuming a single instance. The lock is
 * transaction-scoped (`pg_try_advisory_xact_lock`), so it is released by
 * COMMIT or ROLLBACK — including when a job throws — and never leaks
 * across pooled connections the way a session-level lock would.
 */
import type pg from 'pg';
import { withTenantTx } from '../config/database.js';
import { logger } from '../config/logger.js';

export interface ScheduledJob {
  /** Stable identifier, used in logs. */
  name: string;
  /**
   * Postgres advisory-lock key. Must be unique per job and stable across
   * deploys: it is the only thing preventing two API machines from
   * running the same sweep at the same instant.
   */
  lockKey: number;
  /** How often to attempt the job. */
  intervalMs: number;
  run: (db: pg.PoolClient) => Promise<unknown>;
}

export type JobStatus = 'ran' | 'skipped' | 'error';

export interface JobOutcome {
  name: string;
  status: JobStatus;
  durationMs: number;
  result?: unknown;
  error?: unknown;
}

/** Seam for tests; production uses the real tenant transaction helper. */
export type TxRunner = <T>(
  organizationId: string | null,
  fn: (client: pg.PoolClient) => Promise<T>,
) => Promise<T>;

export interface RunJobDeps {
  tx?: TxRunner;
  now?: () => number;
}

/**
 * Run one job exactly once, if this instance can take the lock.
 *
 * Never throws: a scheduled sweep failing must not take down the API
 * process or stop future ticks. Failures are logged and reported in the
 * returned outcome.
 */
export async function runJobOnce(job: ScheduledJob, deps: RunJobDeps = {}): Promise<JobOutcome> {
  const { tx = withTenantTx, now = Date.now } = deps;
  const startedAt = now();

  try {
    const outcome = await tx(null, async (db) => {
      const { rows } = await db.query<{ acquired: boolean }>(
        'SELECT pg_try_advisory_xact_lock($1) AS acquired',
        [job.lockKey],
      );
      if (!rows[0]?.acquired) return { acquired: false as const };
      return { acquired: true as const, result: await job.run(db) };
    });

    const durationMs = now() - startedAt;
    if (!outcome.acquired) {
      // Another machine is mid-sweep. Normal, not an error.
      logger.debug({ job: job.name }, 'scheduled job skipped — lock held elsewhere');
      return { name: job.name, status: 'skipped', durationMs };
    }
    logger.info({ job: job.name, durationMs, result: outcome.result }, 'scheduled job ran');
    return { name: job.name, status: 'ran', durationMs, result: outcome.result };
  } catch (err) {
    const durationMs = now() - startedAt;
    logger.error({ err, job: job.name, durationMs }, 'scheduled job failed');
    return { name: job.name, status: 'error', durationMs, error: err };
  }
}

export interface StartSchedulerOptions {
  /**
   * Delay before the first pass. Gives the server time to finish booting,
   * and stops a crash-looping machine from hammering the database.
   */
  initialDelayMs?: number;
  runJob?: (job: ScheduledJob) => Promise<JobOutcome>;
}

/**
 * Start every job on its own timer.
 *
 * The returned stopper clears the timers and resolves once any pass that
 * was already running has finished, so shutdown can await it before
 * closing the database pool — otherwise a sweep's transaction would be
 * cut off mid-flight and rolled back.
 */
export function startScheduler(
  jobs: ScheduledJob[],
  options: StartSchedulerOptions = {},
): () => Promise<void> {
  const { initialDelayMs = 30_000, runJob = runJobOnce } = options;
  if (jobs.length === 0) {
    logger.warn(
      'scheduled jobs are DISABLED — forgotten punches will not be closed and audit logs will not be pruned unless an external scheduler runs db:auto-clock-out and db:prune-audit',
    );
    return async () => undefined;
  }

  const timers: NodeJS.Timeout[] = [];
  const inFlight = new Set<Promise<unknown>>();
  let stopped = false;

  for (const job of jobs) {
    const tick = () => {
      if (stopped) return;
      const pass = runJob(job).finally(() => inFlight.delete(pass));
      inFlight.add(pass);
    };
    const starter = setTimeout(() => {
      if (stopped) return;
      tick();
      const interval = setInterval(tick, job.intervalMs);
      interval.unref?.();
      timers.push(interval);
    }, initialDelayMs);
    starter.unref?.();
    timers.push(starter);
    logger.info({ job: job.name, intervalMs: job.intervalMs }, 'scheduled job registered');
  }

  return async () => {
    stopped = true;
    for (const t of timers) {
      clearTimeout(t);
      clearInterval(t);
    }
    // runJobOnce never rejects, but settle rather than all so a stray
    // rejection can never wedge shutdown.
    await Promise.allSettled([...inFlight]);
  };
}
