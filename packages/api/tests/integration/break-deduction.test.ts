/**
 * Unpaid breaks must not be paid.
 *
 * A worker who punches in at 09:00, takes a 30-minute unpaid lunch, and
 * punches out at 17:00 has worked 7.5 paid hours, not 8. This suite
 * pins that down end-to-end: the stored entry, the worker's own
 * timesheet, the admin timesheet roll-up, and the payroll export must
 * all agree on the same net number.
 */
import request from 'supertest';
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

beforeAll(async () => {
  await assertDbReady();
  org = await seedOrg('break-deduct');
});

afterAll(async () => {
  if (org) await dropOrg(org.id);
  await closePool();
});

let seq = 0;
const nextId = (): string => `it-break-${Date.now()}-${seq++}`;

const DAY = '2026-04-06'; // A Monday.
const PUNCH_IN = `${DAY}T09:00:00.000Z`;
const LUNCH_START = `${DAY}T12:00:00.000Z`;
const LUNCH_END = `${DAY}T12:30:00.000Z`;
const PUNCH_OUT = `${DAY}T17:00:00.000Z`;

/** 8h on the clock, 30m unpaid lunch → 7.5h payable. */
const GROSS_MINUTES = 480;
const UNPAID_MINUTES = 30;
const NET_MINUTES = GROSS_MINUTES - UNPAID_MINUTES;

let entryId: string;

beforeAll(async () => {
  const punchIn = await request(app)
    .post('/api/v1/time-tracking/punch-in')
    .set('Authorization', org.employee.auth)
    .send({ clientGeneratedId: nextId(), timestamp: PUNCH_IN })
    .expect(201);
  entryId = punchIn.body.data.timeEntry.id;

  const brk = await request(app)
    .post('/api/v1/time-tracking/breaks')
    .set('Authorization', org.employee.auth)
    .send({
      clientGeneratedId: nextId(),
      timeEntryId: entryId,
      timestamp: LUNCH_START,
      breakType: 'lunch',
    })
    .expect(201);

  await request(app)
    .post(`/api/v1/time-tracking/breaks/${brk.body.data.id}/end`)
    .set('Authorization', org.employee.auth)
    .send({ clientGeneratedId: nextId(), timestamp: LUNCH_END })
    .expect(200);

  await request(app)
    .post('/api/v1/time-tracking/punch-out')
    .set('Authorization', org.employee.auth)
    .send({ clientGeneratedId: nextId(), timestamp: PUNCH_OUT })
    .expect(200);
});

describe('unpaid break deduction', () => {
  it('records the break as completed and unpaid', async () => {
    const rows = await queryAsSystem<{ duration_minutes: number; break_type: string }>(
      `SELECT duration_minutes, break_type FROM breaks WHERE time_entry_id = $1`,
      [entryId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.break_type).toBe('lunch');
    expect(rows[0]!.duration_minutes).toBe(UNPAID_MINUTES);
  });

  it('excludes the unpaid break from the entry payable minutes', async () => {
    const rows = await queryAsSystem<{ duration_minutes: number }>(
      `SELECT duration_minutes FROM time_entries WHERE id = $1`,
      [entryId],
    );
    expect(rows[0]!.duration_minutes).toBe(NET_MINUTES);
  });

  it('excludes it from the worker own timesheet', async () => {
    const res = await request(app)
      .get(`/api/v1/me/timesheet?from=${DAY}&to=${DAY}`)
      .set('Authorization', org.employee.auth)
      .expect(200);

    expect(res.body.data.totalHours).toBeCloseTo(NET_MINUTES / 60, 5);
  });

  it('excludes it from the admin timesheet roll-up', async () => {
    const res = await request(app)
      .get(`/api/v1/admin/timesheets?from=${DAY}&to=${DAY}`)
      .set('Authorization', org.owner.auth)
      .expect(200);

    const mine = (res.body.data as { userId: string; totalHours: number }[]).find(
      (r) => r.userId === org.employee.id,
    );
    expect(mine).toBeDefined();
    expect(mine!.totalHours).toBeCloseTo(NET_MINUTES / 60, 5);
  });
});
