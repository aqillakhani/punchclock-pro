/**
 * Auto clock-out, against the real database.
 *
 * The failure it prevents is worse than untidy data: the partial unique
 * index allows one open entry per worker, so a forgotten punch-out
 * blocks that person's NEXT punch-in entirely.
 */
import request from 'supertest';
import { withTenantTx } from '../../src/config/database.js';
import { runAutoClockOut } from '../../src/services/auto-clock-out.service.js';
import {
  testApp,
  seedOrg,
  dropOrg,
  queryAsSystem,
  assertDbReady,
  closePool,
  type SeededOrg,
} from './helpers/harness.js';

const app = testApp();
let org: SeededOrg;

const CAP_MINUTES = 720; // 12 hours

beforeAll(async () => {
  await assertDbReady();
  org = await seedOrg('auto-clockout');
});

afterAll(async () => {
  if (org) await dropOrg(org.id);
  await closePool();
});

async function setCap(minutes: number | null) {
  await request(app)
    .patch('/api/v1/admin/organization')
    .set('Authorization', org.owner.auth)
    .send({ autoClockOutMinutes: minutes })
    .expect(200);
}

/** Open an entry that started `hoursAgo` hours ago, bypassing punch-in. */
async function openEntry(userId: string, hoursAgo: number): Promise<string> {
  const at = new Date(Date.now() - hoursAgo * 3_600_000).toISOString();
  return withTenantTx(null, async (db) => {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO time_entries (organization_id, user_id, punch_in_at, status)
       VALUES ($1, $2, $3, 'in_progress') RETURNING id`,
      [org.id, userId, at],
    );
    return rows[0]!.id;
  });
}

async function sweep() {
  return withTenantTx(null, (db) => runAutoClockOut(db));
}

async function clearEntries() {
  await withTenantTx(null, async (db) => {
    await db.query(`DELETE FROM time_entries WHERE organization_id = $1`, [org.id]);
  });
}

describe('when the feature is off', () => {
  it('leaves a long-open entry alone', async () => {
    await setCap(null);
    await clearEntries();
    const id = await openEntry(org.employee.id, 30);

    const result = await sweep();
    expect(result.entries.some((e) => e.id === id)).toBe(false);

    const rows = await queryAsSystem<{ punch_out_at: string | null }>(
      `SELECT punch_out_at FROM time_entries WHERE id = $1`,
      [id],
    );
    expect(rows[0]!.punch_out_at).toBeNull();
  });
});

describe('when the feature is on', () => {
  beforeAll(async () => {
    await setCap(CAP_MINUTES);
  });

  beforeEach(async () => {
    await clearEntries();
  });

  it('leaves an entry that has not yet hit the cap', async () => {
    const id = await openEntry(org.employee.id, 5);
    await sweep();
    const rows = await queryAsSystem<{ punch_out_at: string | null }>(
      `SELECT punch_out_at FROM time_entries WHERE id = $1`,
      [id],
    );
    expect(rows[0]!.punch_out_at).toBeNull();
  });

  it('closes one that is past the cap, AT the cap rather than now', async () => {
    const id = await openEntry(org.employee.id, 30);
    const result = await sweep();
    expect(result.closed).toBeGreaterThan(0);

    const rows = await queryAsSystem<{
      punch_in_at: string;
      punch_out_at: string;
      duration_minutes: number;
      gross_minutes: number;
      status: string;
      auto_closed: boolean;
      notes: string | null;
    }>(
      `SELECT punch_in_at, punch_out_at, duration_minutes, gross_minutes,
              status, auto_closed, notes
       FROM time_entries WHERE id = $1`,
      [id],
    );
    const e = rows[0]!;

    // 30 hours open, 12-hour cap → exactly 12 hours paid, not 30.
    expect(e.gross_minutes).toBe(CAP_MINUTES);
    expect(e.duration_minutes).toBe(CAP_MINUTES);
    const span = (Date.parse(e.punch_out_at) - Date.parse(e.punch_in_at)) / 60_000;
    expect(span).toBe(CAP_MINUTES);
    expect(e.status).toBe('completed');
    expect(e.auto_closed).toBe(true);
    expect(e.notes).toMatch(/automatically clocked out/i);
  });

  it('unblocks the worker so they can punch in again', async () => {
    await openEntry(org.employee.id, 30);

    // Before the sweep the open entry blocks a new punch.
    await request(app)
      .post('/api/v1/time-tracking/punch-in')
      .set('Authorization', org.employee.auth)
      .send({ clientGeneratedId: `blocked-${Date.now()}`, timestamp: new Date().toISOString() })
      .expect(409);

    await sweep();

    await request(app)
      .post('/api/v1/time-tracking/punch-in')
      .set('Authorization', org.employee.auth)
      .send({ clientGeneratedId: `unblocked-${Date.now()}`, timestamp: new Date().toISOString() })
      .expect(201);
  });

  it('deducts an unpaid break that was still running', async () => {
    const id = await openEntry(org.employee.id, 30);
    const punchIn = (
      await queryAsSystem<{ punch_in_at: string }>(
        `SELECT punch_in_at FROM time_entries WHERE id = $1`,
        [id],
      )
    )[0]!.punch_in_at;

    // A lunch started two hours in and never ended.
    const breakStart = new Date(Date.parse(punchIn) + 2 * 3_600_000).toISOString();
    await withTenantTx(null, async (db) => {
      await db.query(
        `INSERT INTO breaks (organization_id, time_entry_id, user_id, break_start, break_type, status)
         VALUES ($1, $2, $3, $4, 'lunch', 'in_progress')`,
        [org.id, id, org.employee.id, breakStart],
      );
    });

    await sweep();

    const rows = await queryAsSystem<{
      gross_minutes: number;
      unpaid_break_minutes: number;
      duration_minutes: number;
    }>(
      `SELECT gross_minutes, unpaid_break_minutes, duration_minutes
       FROM time_entries WHERE id = $1`,
      [id],
    );
    const e = rows[0]!;
    // The open break is closed at the same instant, so it runs from
    // hour 2 to hour 12 — ten unpaid hours off a twelve-hour shift.
    expect(e.gross_minutes).toBe(CAP_MINUTES);
    expect(e.unpaid_break_minutes).toBe(600);
    expect(e.duration_minutes).toBe(CAP_MINUTES - 600);
  });

  it('writes a system audit row with no actor', async () => {
    const id = await openEntry(org.employee.id, 30);
    await sweep();
    const rows = await queryAsSystem<{ actor_user_id: string | null; action: string }>(
      `SELECT actor_user_id, action FROM audit_logs
       WHERE resource_id = $1 AND action = 'auto_clock_out'`,
      [id],
    );
    expect(rows).toHaveLength(1);
    // Nobody did this — the system did.
    expect(rows[0]!.actor_user_id).toBeNull();
  });

  it('appends a punch_out event flagged as automatic', async () => {
    const id = await openEntry(org.employee.id, 30);
    await sweep();
    const rows = await queryAsSystem<{ event_type: string; event_data: { autoClosed?: boolean } }>(
      `SELECT event_type, event_data FROM time_entry_events WHERE time_entry_id = $1`,
      [id],
    );
    const evt = rows.find((r) => r.event_type === 'punch_out');
    expect(evt).toBeDefined();
    expect(evt!.event_data.autoClosed).toBe(true);
  });

  it('is idempotent — a second sweep closes nothing more', async () => {
    await openEntry(org.employee.id, 30);
    const first = await sweep();
    expect(first.closed).toBe(1);
    const second = await sweep();
    expect(second.closed).toBe(0);
  });

  it('handles several workers in one sweep', async () => {
    await openEntry(org.employee.id, 20);
    await openEntry(org.coworker.id, 40);
    await openEntry(org.manager.id, 1); // under the cap
    const result = await sweep();
    expect(result.closed).toBe(2);
  });

  it('leaves the auto-closed entry correctable by the worker', async () => {
    const id = await openEntry(org.employee.id, 30);
    await sweep();

    // The whole point of capping rather than guessing: the worker can
    // tell us what actually happened.
    const punchIn = (
      await queryAsSystem<{ punch_in_at: string }>(
        `SELECT punch_in_at FROM time_entries WHERE id = $1`,
        [id],
      )
    )[0]!.punch_in_at;
    const realEnd = new Date(Date.parse(punchIn) + 8 * 3_600_000).toISOString();

    await request(app)
      .post('/api/v1/me/corrections')
      .set('Authorization', org.employee.auth)
      .send({
        requestType: 'edit_times',
        timeEntryId: id,
        requestedPunchOutAt: realEnd,
        reason: 'I actually left at 8 hours; forgot to clock out.',
      })
      .expect(201);
  });
});

describe('does not touch another organization', () => {
  it('only closes entries for orgs that opted in', async () => {
    await setCap(CAP_MINUTES);
    await clearEntries();

    const other = await seedOrg('auto-clockout-off');
    try {
      const otherEntry = await withTenantTx(null, async (db) => {
        const { rows } = await db.query<{ id: string }>(
          `INSERT INTO time_entries (organization_id, user_id, punch_in_at, status)
           VALUES ($1, $2, $3, 'in_progress') RETURNING id`,
          [other.id, other.employee.id, new Date(Date.now() - 30 * 3_600_000).toISOString()],
        );
        return rows[0]!.id;
      });

      const mine = await openEntry(org.employee.id, 30);
      const result = await sweep();

      expect(result.entries.map((e) => e.id)).toContain(mine);
      expect(result.entries.map((e) => e.id)).not.toContain(otherEntry);
    } finally {
      await dropOrg(other.id);
    }
  });
});
