import type pg from 'pg';
import {
  runJobOnce,
  startScheduler,
  type ScheduledJob,
  type TxRunner,
} from '../../src/jobs/scheduler.js';
import { scheduledJobs, JOB_LOCK_KEYS } from '../../src/jobs/index.js';
import type { AppEnv } from '../../src/config/env.js';

/**
 * Fake tenant transaction. `acquired` decides what
 * pg_try_advisory_xact_lock reports back, so a job can be put in the
 * "another machine already holds it" state.
 */
function fakeTx(opts: { acquired?: boolean; queries?: unknown[][] } = {}): TxRunner {
  const { acquired = true, queries = [] } = opts;
  return async (orgId, fn) => {
    const client = {
      query: async (sql: string, params?: unknown[]) => {
        queries.push([sql, params, orgId]);
        if (sql.includes('pg_try_advisory_xact_lock')) {
          return { rows: [{ acquired }] };
        }
        return { rows: [], rowCount: 0 };
      },
    } as unknown as pg.PoolClient;
    return fn(client);
  };
}

const job = (over: Partial<ScheduledJob> = {}): ScheduledJob => ({
  name: 'test-job',
  lockKey: 999,
  intervalMs: 1_000,
  run: async () => 'done',
  ...over,
});

describe('runJobOnce', () => {
  it('takes the advisory lock and runs the job', async () => {
    const queries: unknown[][] = [];
    let ran = 0;
    const outcome = await runJobOnce(
      job({
        run: async () => {
          ran += 1;
          return { closed: 3 };
        },
      }),
      { tx: fakeTx({ queries }) },
    );

    expect(ran).toBe(1);
    expect(outcome.status).toBe('ran');
    expect(outcome.result).toEqual({ closed: 3 });
    expect(String(queries[0]![0])).toContain('pg_try_advisory_xact_lock');
    expect(queries[0]![1]).toEqual([999]);
  });

  it('runs as a system job with RLS bypassed, not scoped to one tenant', async () => {
    // These sweeps cross every organization; scoping them to an org would
    // silently skip all the others.
    const queries: unknown[][] = [];
    await runJobOnce(job(), { tx: fakeTx({ queries }) });
    expect(queries[0]![2]).toBeNull();
  });

  it('skips without running when another machine holds the lock', async () => {
    let ran = 0;
    const outcome = await runJobOnce(
      job({
        run: async () => {
          ran += 1;
          return null;
        },
      }),
      { tx: fakeTx({ acquired: false }) },
    );

    expect(ran).toBe(0);
    expect(outcome.status).toBe('skipped');
  });

  it('swallows a throwing job so the timer survives', async () => {
    const outcome = await runJobOnce(
      job({
        run: async () => {
          throw new Error('boom');
        },
      }),
      { tx: fakeTx() },
    );

    expect(outcome.status).toBe('error');
    expect((outcome.error as Error).message).toBe('boom');
  });

  it('swallows a transaction that cannot even be opened', async () => {
    const tx: TxRunner = async () => {
      throw new Error('connection terminated');
    };
    const outcome = await runJobOnce(job(), { tx });
    expect(outcome.status).toBe('error');
  });

  it('reports how long the job took', async () => {
    let clock = 1_000;
    const outcome = await runJobOnce(job(), {
      tx: fakeTx(),
      now: () => {
        const t = clock;
        clock += 250;
        return t;
      },
    });
    expect(outcome.durationMs).toBe(250);
  });
});

describe('startScheduler', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('waits the initial delay, then runs on the interval', () => {
    const calls: string[] = [];
    const stop = startScheduler([job({ intervalMs: 10_000 })], {
      initialDelayMs: 5_000,
      runJob: async (j) => {
        calls.push(j.name);
        return { name: j.name, status: 'ran', durationMs: 0 };
      },
    });

    expect(calls).toHaveLength(0);
    jest.advanceTimersByTime(5_000);
    expect(calls).toHaveLength(1); // first pass
    jest.advanceTimersByTime(30_000);
    expect(calls).toHaveLength(4); // plus three intervals
    stop();
  });

  it('stops firing once stopped', () => {
    const calls: string[] = [];
    const stop = startScheduler([job({ intervalMs: 1_000 })], {
      initialDelayMs: 0,
      runJob: async (j) => {
        calls.push(j.name);
        return { name: j.name, status: 'ran', durationMs: 0 };
      },
    });

    jest.advanceTimersByTime(3_000);
    const before = calls.length;
    expect(before).toBeGreaterThan(0);

    stop();
    jest.advanceTimersByTime(60_000);
    expect(calls).toHaveLength(before);
  });

  it('does not fire anything when the job list is empty', () => {
    const stop = startScheduler([], { initialDelayMs: 0 });
    jest.advanceTimersByTime(60_000);
    stop();
  });

  it('runs each job on its own independent cadence', () => {
    const calls: string[] = [];
    const stop = startScheduler(
      [job({ name: 'fast', intervalMs: 1_000 }), job({ name: 'slow', intervalMs: 10_000 })],
      {
        initialDelayMs: 0,
        runJob: async (j) => {
          calls.push(j.name);
          return { name: j.name, status: 'ran', durationMs: 0 };
        },
      },
    );

    jest.advanceTimersByTime(10_000);
    expect(calls.filter((c) => c === 'fast').length).toBeGreaterThan(
      calls.filter((c) => c === 'slow').length,
    );
    stop();
  });
});

describe('scheduledJobs', () => {
  const env = (over: Partial<AppEnv> = {}): AppEnv =>
    ({
      SCHEDULED_JOBS_ENABLED: true,
      AUTO_CLOCK_OUT_INTERVAL_MINUTES: 60,
      AUDIT_LOG_PRUNE_INTERVAL_MINUTES: 1440,
      ...over,
    }) as AppEnv;

  it('schedules auto clock-out hourly and audit pruning daily by default', () => {
    const jobs = scheduledJobs(env());
    expect(jobs.map((j) => j.name)).toEqual(['auto-clock-out', 'prune-audit-logs']);
    expect(jobs[0]!.intervalMs).toBe(60 * 60_000);
    expect(jobs[1]!.intervalMs).toBe(24 * 60 * 60_000);
  });

  it('gives every job a distinct lock key', () => {
    const keys = scheduledJobs(env()).map((j) => j.lockKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain(JOB_LOCK_KEYS.autoClockOut);
    expect(keys).toContain(JOB_LOCK_KEYS.pruneAuditLogs);
  });

  it('honours interval overrides', () => {
    const jobs = scheduledJobs(env({ AUTO_CLOCK_OUT_INTERVAL_MINUTES: 15 }));
    expect(jobs[0]!.intervalMs).toBe(15 * 60_000);
  });

  it('returns nothing when scheduling is switched off', () => {
    expect(scheduledJobs(env({ SCHEDULED_JOBS_ENABLED: false }))).toEqual([]);
  });
});
