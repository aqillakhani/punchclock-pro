/**
 * Scheduled sweeps, against the real database.
 *
 * Two things a fake transaction cannot prove, and both matter the moment
 * the API runs on more than one machine:
 *   1. `pg_try_advisory_xact_lock` actually excludes a second runner.
 *   2. The lock is released by the transaction ending — including when
 *      the job throws — so a crashed sweep does not wedge the next one.
 *
 * It also checks the wiring end to end: a forgotten punch left open past
 * the org's cap is closed by the scheduler, not just by the CLI.
 */
import { getPool, withTenantTx } from '../../src/config/database.js';
import { runJobOnce, type ScheduledJob } from '../../src/jobs/scheduler.js';
import { scheduledJobs } from '../../src/jobs/index.js';
import { loadEnv } from '../../src/config/env.js';
import {
  seedOrg,
  dropOrg,
  queryAsSystem,
  assertDbReady,
  closePool,
  type SeededOrg,
} from './helpers/harness.js';

let org: SeededOrg;

// A key no production job uses, so a real sweep cannot interfere.
const TEST_LOCK_KEY = 9_140_777;

beforeAll(async () => {
  await assertDbReady();
  org = await seedOrg('scheduled-jobs');
});

afterAll(async () => {
  if (org) await dropOrg(org.id);
  await closePool();
});

const job = (over: Partial<ScheduledJob> = {}): ScheduledJob => ({
  name: 'test-sweep',
  lockKey: TEST_LOCK_KEY,
  intervalMs: 60_000,
  run: async () => 'ok',
  ...over,
});

describe('advisory locking against real Postgres', () => {
  it('lets a single runner through', async () => {
    const outcome = await runJobOnce(job());
    expect(outcome.status).toBe('ran');
    expect(outcome.result).toBe('ok');
  });

  it('excludes a second runner while the first holds the lock', async () => {
    // Hold the lock open in one transaction, and try to run the job from
    // another connection while it is held.
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    // Do not race the holder: wait until the lock is provably taken before
    // the contender tries, or a slow connect would make this pass for the
    // wrong reason.
    let acquired!: () => void;
    const lockTaken = new Promise<void>((resolve) => {
      acquired = resolve;
    });

    let ranInside = 0;
    const holder = withTenantTx(null, async (db) => {
      const { rows } = await db.query<{ acquired: boolean }>(
        'SELECT pg_try_advisory_xact_lock($1) AS acquired',
        [TEST_LOCK_KEY],
      );
      expect(rows[0]!.acquired).toBe(true);
      acquired();
      await held; // keep the transaction — and the lock — open
      return null;
    });

    await lockTaken;
    const outcome = await runJobOnce(
      job({
        run: async () => {
          ranInside += 1;
          return 'ok';
        },
      }),
    );

    release();
    await holder;

    expect(outcome.status).toBe('skipped');
    expect(ranInside).toBe(0);
  });

  it('releases the lock when the job throws, so the next pass still runs', async () => {
    const failed = await runJobOnce(
      job({
        run: async () => {
          throw new Error('sweep exploded');
        },
      }),
    );
    expect(failed.status).toBe('error');

    // If the rollback had not released the lock this would report skipped.
    const next = await runJobOnce(job());
    expect(next.status).toBe('ran');
  });

  it('releases the lock after a successful pass', async () => {
    await runJobOnce(job());
    const again = await runJobOnce(job());
    expect(again.status).toBe('ran');
  });
});

describe('the real job definitions run against the database', () => {
  it('every configured job completes a pass', async () => {
    const jobs = scheduledJobs(loadEnv());
    expect(jobs.length).toBeGreaterThan(0);

    for (const j of jobs) {
      const outcome = await runJobOnce(j);
      // 'skipped' would mean a concurrent runner, which cannot happen here.
      expect(outcome.status).toBe('ran');
    }
  });

  it('auto clock-out closes a forgotten punch when driven by the scheduler', async () => {
    const capMinutes = 720;
    await queryAsSystem(`UPDATE organizations SET auto_clock_out_minutes = $1 WHERE id = $2`, [
      capMinutes,
      org.id,
    ]);

    const punchInAt = new Date(Date.now() - 20 * 60 * 60 * 1000).toISOString();
    const inserted = await queryAsSystem<{ id: string }>(
      `INSERT INTO time_entries (organization_id, user_id, punch_in_at, status)
       VALUES ($1, $2, $3, 'in_progress') RETURNING id`,
      [org.id, org.owner.id, punchInAt],
    );
    const entryId = inserted[0]!.id;

    const autoClockOut = scheduledJobs(loadEnv()).find((j) => j.name === 'auto-clock-out');
    expect(autoClockOut).toBeDefined();

    const outcome = await runJobOnce(autoClockOut!);
    expect(outcome.status).toBe('ran');

    const [row] = await queryAsSystem<{ status: string; punch_out_at: string | null }>(
      `SELECT status, punch_out_at FROM time_entries WHERE id = $1`,
      [entryId],
    );
    expect(row!.status).not.toBe('in_progress');
    expect(row!.punch_out_at).not.toBeNull();

    await queryAsSystem(`DELETE FROM time_entries WHERE id = $1`, [entryId]);
    await queryAsSystem(`UPDATE organizations SET auto_clock_out_minutes = NULL WHERE id = $1`, [
      org.id,
    ]);
  });
});

describe('pool hygiene', () => {
  it('does not leak a connection per pass', async () => {
    const pool = getPool();
    const before = pool.idleCount + pool.totalCount;
    for (let i = 0; i < 5; i += 1) {
      await runJobOnce(job());
    }
    expect(pool.totalCount).toBeLessThanOrEqual(before + 1);
  });
});
