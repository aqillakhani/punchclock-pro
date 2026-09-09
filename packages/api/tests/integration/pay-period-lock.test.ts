/**
 * Pay-period locking, enforced end to end.
 *
 * A lock is the product's promise that payroll for those dates is final.
 * The promise is only worth anything if EVERY retroactive write path
 * respects it, so each one is exercised here: filing a correction,
 * approving one that was filed before the lock, and the manager's direct
 * create / edit / delete.
 */
import request from 'supertest';
import {
  testApp,
  seedOrg,
  dropOrg,
  insertCompletedEntry,
  queryAsSystem,
  assertDbReady,
  closePool,
  type SeededOrg,
} from './helpers/harness.js';

const app = testApp();
let org: SeededOrg;

beforeAll(async () => {
  await assertDbReady();
  org = await seedOrg('pay-lock');
  // Weekly periods anchored on a known Monday keeps the arithmetic in
  // these tests obvious.
  await request(app)
    .patch('/api/v1/admin/organization')
    .set('Authorization', org.owner.auth)
    .send({ payPeriodType: 'weekly', payPeriodAnchorDate: '2026-01-05' })
    .expect(200);
});

afterAll(async () => {
  if (org) await dropOrg(org.id);
  await closePool();
});

/** A Monday-start week well inside the 60-day correction window. */
function recentWeek(weeksAgo: number): { start: string; iso: (h: number) => string } {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  // Walk back to Monday, then back N weeks.
  const dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dow - weeksAgo * 7);
  const start = d.toISOString().slice(0, 10);
  // Use the Tuesday of that week so the entry is comfortably inside.
  const day = new Date(d);
  day.setUTCDate(day.getUTCDate() + 1);
  return {
    start,
    iso: (h: number) => {
      const x = new Date(day);
      x.setUTCHours(h, 0, 0, 0);
      return x.toISOString();
    },
  };
}

/** Not async — callers chain `.expect(...)`, which needs the supertest Test. */
function lock(startDate: string, auth = org.owner.auth) {
  return request(app)
    .post('/api/v1/admin/pay-periods/lock')
    .set('Authorization', auth)
    .send({ startDate, note: 'Payroll run' });
}

describe('listing periods', () => {
  it('shows recent periods with the current one flagged', async () => {
    const res = await request(app)
      .get('/api/v1/admin/pay-periods?count=4')
      .set('Authorization', org.owner.auth)
      .expect(200);

    const periods = res.body.data as { startDate: string; status: string; isCurrent: boolean }[];
    expect(periods).toHaveLength(4);
    expect(periods.filter((p) => p.isCurrent)).toHaveLength(1);
    expect(periods.every((p) => p.status === 'open' || p.status === 'locked')).toBe(true);
  });

  it('is visible to a manager but lockable only by an owner', async () => {
    await request(app)
      .get('/api/v1/admin/pay-periods')
      .set('Authorization', org.manager.auth)
      .expect(200);

    const week = recentWeek(9);
    await lock(week.start, org.manager.auth).expect(403);
  });

  it('is hidden from an employee', async () => {
    await request(app)
      .get('/api/v1/admin/pay-periods')
      .set('Authorization', org.employee.auth)
      .expect(403);
  });
});

describe('locking', () => {
  it('refuses a start date that is not a period boundary', async () => {
    const week = recentWeek(3);
    const notMonday = new Date(`${week.start}T00:00:00Z`);
    notMonday.setUTCDate(notMonday.getUTCDate() + 2);
    const res = await lock(notMonday.toISOString().slice(0, 10)).expect(422);
    expect(res.body.error.message).toMatch(/not the first day/i);
  });

  it('records who locked it and when', async () => {
    const week = recentWeek(4);
    await lock(week.start).expect(200);

    const rows = await queryAsSystem<{ status: string; locked_by: string; locked_at: string }>(
      `SELECT status, locked_by, locked_at FROM pay_periods WHERE start_date = $1`,
      [week.start],
    );
    expect(rows[0]!.status).toBe('locked');
    expect(rows[0]!.locked_by).toBe(org.owner.id);
    expect(rows[0]!.locked_at).not.toBeNull();
  });

  it('is idempotent', async () => {
    const week = recentWeek(5);
    await lock(week.start).expect(200);
    await lock(week.start).expect(200);
    const rows = await queryAsSystem<{ count: string }>(
      `SELECT count(*)::text AS count FROM pay_periods WHERE start_date = $1`,
      [week.start],
    );
    expect(Number(rows[0]!.count)).toBe(1);
  });

  it('writes an audit row', async () => {
    const week = recentWeek(6);
    await lock(week.start).expect(200);
    const rows = await queryAsSystem<{ actor_user_id: string }>(
      `SELECT actor_user_id FROM audit_logs
       WHERE action = 'pay_period_locked' AND resource_id = $1`,
      [week.start],
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]!.actor_user_id).toBe(org.owner.id);
  });
});

describe('a locked period refuses retroactive change', () => {
  let week: ReturnType<typeof recentWeek>;
  let entryId: string;

  beforeAll(async () => {
    week = recentWeek(2);
    entryId = await insertCompletedEntry(org.id, org.employee.id, week.iso(9), week.iso(17));
    await lock(week.start).expect(200);
  });

  it('blocks an employee filing a correction', async () => {
    const res = await request(app)
      .post('/api/v1/me/corrections')
      .set('Authorization', org.employee.auth)
      .send({
        requestType: 'edit_times',
        timeEntryId: entryId,
        requestedPunchOutAt: week.iso(18),
        reason: 'ran late',
      })
      .expect(409);
    expect(res.body.error.message).toMatch(/locked/i);
  });

  it('blocks adding a missing shift inside it', async () => {
    await request(app)
      .post('/api/v1/me/corrections')
      .set('Authorization', org.employee.auth)
      .send({
        requestType: 'add_entry',
        requestedPunchInAt: week.iso(6),
        requestedPunchOutAt: week.iso(8),
        reason: 'forgot to clock in',
      })
      .expect(409);
  });

  it('blocks a manager editing an entry directly', async () => {
    await request(app)
      .patch(`/api/v1/admin/time-entries/${entryId}`)
      .set('Authorization', org.manager.auth)
      .send({ punchOutAt: week.iso(19), reason: 'adjusting' })
      .expect(409);
  });

  it('blocks a manager creating an entry inside it', async () => {
    await request(app)
      .post('/api/v1/admin/time-entries')
      .set('Authorization', org.manager.auth)
      .send({
        userId: org.coworker.id,
        punchInAt: week.iso(10),
        punchOutAt: week.iso(14),
        reason: 'missed shift',
      })
      .expect(409);
  });

  it('blocks a manager deleting an entry inside it', async () => {
    await request(app)
      .delete(`/api/v1/admin/time-entries/${entryId}?reason=oops`)
      .set('Authorization', org.manager.auth)
      .expect(409);
  });

  it('blocks moving an OPEN entry INTO the locked period', async () => {
    const open = recentWeek(0);
    const movable = await insertCompletedEntry(org.id, org.coworker.id, open.iso(9), open.iso(17));
    await request(app)
      .patch(`/api/v1/admin/time-entries/${movable}`)
      .set('Authorization', org.owner.auth)
      .send({ punchInAt: week.iso(9), punchOutAt: week.iso(17), reason: 'moving in' })
      .expect(409);
  });

  it('leaves the entry untouched after all those refusals', async () => {
    const rows = await queryAsSystem<{ duration_minutes: number; status: string }>(
      `SELECT duration_minutes, status FROM time_entries WHERE id = $1`,
      [entryId],
    );
    expect(rows[0]!.duration_minutes).toBe(480);
    expect(rows[0]!.status).toBe('completed');
  });

  it('still allows changes in an OPEN period', async () => {
    const open = recentWeek(0);
    const openEntry = await insertCompletedEntry(
      org.id,
      org.employee.id,
      open.iso(9),
      open.iso(17),
    );
    await request(app)
      .patch(`/api/v1/admin/time-entries/${openEntry}`)
      .set('Authorization', org.owner.auth)
      .send({ punchOutAt: open.iso(18), reason: 'genuine correction' })
      .expect(200);
  });
});

describe('approving a request after the period is locked', () => {
  it('is refused even though the request was filed while it was open', async () => {
    const week = recentWeek(7);
    const entryId = await insertCompletedEntry(org.id, org.employee.id, week.iso(9), week.iso(17));

    // Filed while still open…
    const req = await request(app)
      .post('/api/v1/me/corrections')
      .set('Authorization', org.employee.auth)
      .send({
        requestType: 'edit_times',
        timeEntryId: entryId,
        requestedPunchOutAt: week.iso(18),
        reason: 'stayed late',
      })
      .expect(201);

    // …payroll runs and the period is locked…
    await lock(week.start).expect(200);

    // …so the approval must now be refused, not silently applied.
    const decision = await request(app)
      .post(`/api/v1/admin/corrections/${req.body.data.id}/decision`)
      .set('Authorization', org.manager.auth)
      .send({ decision: 'approved' })
      .expect(409);
    expect(decision.body.error.message).toMatch(/locked/i);

    const rows = await queryAsSystem<{ duration_minutes: number }>(
      `SELECT duration_minutes FROM time_entries WHERE id = $1`,
      [entryId],
    );
    expect(rows[0]!.duration_minutes).toBe(480);
  });

  it('can still be REJECTED, since that changes no hours', async () => {
    const week = recentWeek(8);
    const entryId = await insertCompletedEntry(org.id, org.employee.id, week.iso(9), week.iso(17));
    const req = await request(app)
      .post('/api/v1/me/corrections')
      .set('Authorization', org.employee.auth)
      .send({
        requestType: 'edit_times',
        timeEntryId: entryId,
        requestedPunchOutAt: week.iso(18),
        reason: 'stayed late',
      })
      .expect(201);

    await lock(week.start).expect(200);

    await request(app)
      .post(`/api/v1/admin/corrections/${req.body.data.id}/decision`)
      .set('Authorization', org.manager.auth)
      .send({ decision: 'rejected', note: 'period already paid' })
      .expect(200);
  });
});

describe('unlocking', () => {
  it('requires a reason, reopens the period, and is audited', async () => {
    const week = recentWeek(10);
    const entryId = await insertCompletedEntry(org.id, org.employee.id, week.iso(9), week.iso(17));
    await lock(week.start).expect(200);

    await request(app)
      .patch(`/api/v1/admin/time-entries/${entryId}`)
      .set('Authorization', org.owner.auth)
      .send({ punchOutAt: week.iso(18), reason: 'fixing' })
      .expect(409);

    // No reason → refused.
    await request(app)
      .post('/api/v1/admin/pay-periods/unlock')
      .set('Authorization', org.owner.auth)
      .send({ startDate: week.start })
      .expect(422);

    await request(app)
      .post('/api/v1/admin/pay-periods/unlock')
      .set('Authorization', org.owner.auth)
      .send({ startDate: week.start, reason: 'Payroll was run with the wrong hours' })
      .expect(200);

    // Now the edit goes through.
    await request(app)
      .patch(`/api/v1/admin/time-entries/${entryId}`)
      .set('Authorization', org.owner.auth)
      .send({ punchOutAt: week.iso(18), reason: 'fixing' })
      .expect(200);

    const audit = await queryAsSystem<{ changes: { reason?: string } }>(
      `SELECT changes FROM audit_logs
       WHERE action = 'pay_period_unlocked' AND resource_id = $1`,
      [week.start],
    );
    expect(audit[0]!.changes.reason).toMatch(/wrong hours/i);
  });

  it('refuses to unlock a period that is not locked', async () => {
    const week = recentWeek(11);
    await request(app)
      .post('/api/v1/admin/pay-periods/unlock')
      .set('Authorization', org.owner.auth)
      .send({ startDate: week.start, reason: 'nothing to do' })
      .expect(409);
  });

  it('is refused to a manager', async () => {
    const week = recentWeek(12);
    await lock(week.start).expect(200);
    await request(app)
      .post('/api/v1/admin/pay-periods/unlock')
      .set('Authorization', org.manager.auth)
      .send({ startDate: week.start, reason: 'let me in' })
      .expect(403);
  });
});

describe('live punching is never blocked by a lock', () => {
  it('lets a worker clock in and out even if the current period is locked', async () => {
    const current = recentWeek(0);
    await lock(current.start).expect(200);

    // Trapping someone on the clock would be worse than the accounting
    // problem locking protects against, so punching stays open.
    const punchIn = await request(app)
      .post('/api/v1/time-tracking/punch-in')
      .set('Authorization', org.coworker.auth)
      .send({ clientGeneratedId: `lock-live-${Date.now()}`, timestamp: new Date().toISOString() })
      .expect(201);
    expect(punchIn.body.data.timeEntry.id).toEqual(expect.any(String));

    await request(app)
      .post('/api/v1/time-tracking/punch-out')
      .set('Authorization', org.coworker.auth)
      .send({
        clientGeneratedId: `lock-live-out-${Date.now()}`,
        timestamp: new Date(Date.now() + 60_000).toISOString(),
      })
      .expect(200);

    await request(app)
      .post('/api/v1/admin/pay-periods/unlock')
      .set('Authorization', org.owner.auth)
      .send({ startDate: current.start, reason: 'test cleanup' })
      .expect(200);
  });
});
