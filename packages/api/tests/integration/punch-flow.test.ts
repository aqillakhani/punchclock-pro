/**
 * End-to-end punch lifecycle against the real app + real Postgres.
 *
 * These are the assertions the unit suite structurally cannot make:
 * that RLS is engaged, that the tenant transaction commits, that the
 * open-entry unique index actually holds, and that authorization is
 * enforced on data rather than only on route entry.
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
  org = await seedOrg('punch-flow');
});

afterAll(async () => {
  if (org) await dropOrg(org.id);
  await closePool();
});

const iso = (d: Date): string => d.toISOString();
let seq = 0;
const nextId = (): string => `it-punch-${Date.now()}-${seq++}`;

describe('punch in → punch out', () => {
  it('creates an entry, closes it, and computes duration', async () => {
    const inAt = new Date('2026-03-02T09:00:00.000Z');
    const outAt = new Date('2026-03-02T17:30:00.000Z');

    const punchIn = await request(app)
      .post('/api/v1/time-tracking/punch-in')
      .set('Authorization', org.employee.auth)
      .send({ clientGeneratedId: nextId(), timestamp: iso(inAt) });

    expect(punchIn.status).toBe(201);
    const entryId = punchIn.body.data.timeEntry.id as string;
    expect(punchIn.body.data.timeEntry.status).toBe('in_progress');

    const punchOut = await request(app)
      .post('/api/v1/time-tracking/punch-out')
      .set('Authorization', org.employee.auth)
      .send({ clientGeneratedId: nextId(), timestamp: iso(outAt) });

    expect(punchOut.status).toBe(200);
    expect(punchOut.body.data.timeEntry.id).toBe(entryId);
    expect(punchOut.body.data.timeEntry.status).toBe('completed');
    expect(punchOut.body.data.timeEntry.durationMinutes).toBe(510);
  });

  it('refuses a second concurrent punch-in', async () => {
    await request(app)
      .post('/api/v1/time-tracking/punch-in')
      .set('Authorization', org.coworker.auth)
      .send({ clientGeneratedId: nextId(), timestamp: iso(new Date('2026-03-03T09:00:00.000Z')) })
      .expect(201);

    const second = await request(app)
      .post('/api/v1/time-tracking/punch-in')
      .set('Authorization', org.coworker.auth)
      .send({ clientGeneratedId: nextId(), timestamp: iso(new Date('2026-03-03T09:05:00.000Z')) });

    expect(second.status).toBe(409);

    // Clean up so later tests see a closed clock for this user.
    await request(app)
      .post('/api/v1/time-tracking/punch-out')
      .set('Authorization', org.coworker.auth)
      .send({ clientGeneratedId: nextId(), timestamp: iso(new Date('2026-03-03T17:00:00.000Z')) })
      .expect(200);
  });

  it('is idempotent on a replayed clientGeneratedId', async () => {
    const replayId = nextId();
    const ts = iso(new Date('2026-03-04T08:00:00.000Z'));

    const first = await request(app)
      .post('/api/v1/time-tracking/punch-in')
      .set('Authorization', org.employee.auth)
      .send({ clientGeneratedId: replayId, timestamp: ts })
      .expect(201);

    const replay = await request(app)
      .post('/api/v1/time-tracking/punch-in')
      .set('Authorization', org.employee.auth)
      .send({ clientGeneratedId: replayId, timestamp: ts })
      .expect(201);

    expect(replay.body.data.timeEntry.id).toBe(first.body.data.timeEntry.id);

    const rows = await queryAsSystem<{ count: string }>(
      `SELECT count(*)::text AS count FROM time_entries WHERE user_id = $1 AND status = 'in_progress'`,
      [org.employee.id],
    );
    expect(Number(rows[0]!.count)).toBe(1);

    await request(app)
      .post('/api/v1/time-tracking/punch-out')
      .set('Authorization', org.employee.auth)
      .send({ clientGeneratedId: nextId(), timestamp: iso(new Date('2026-03-04T12:00:00.000Z')) })
      .expect(200);
  });

  it('writes an immutable event per punch', async () => {
    const events = await queryAsSystem<{ event_type: string }>(
      `SELECT event_type FROM time_entry_events WHERE user_id = $1 ORDER BY recorded_at`,
      [org.employee.id],
    );
    expect(events.map((e) => e.event_type)).toEqual(
      expect.arrayContaining(['punch_in', 'punch_out']),
    );
  });
});

describe('authorization on time entries', () => {
  it('rejects an unauthenticated request', async () => {
    await request(app).get('/api/v1/time-tracking/entries').expect(401);
  });

  it('scopes an employee to their own entries by default', async () => {
    const res = await request(app)
      .get('/api/v1/time-tracking/entries')
      .set('Authorization', org.employee.auth)
      .expect(200);

    const userIds: string[] = res.body.data.map((e: { userId: string }) => e.userId);
    expect(new Set(userIds)).toEqual(new Set([org.employee.id]));
  });

  it('does not let an employee read a coworker via ?userId', async () => {
    const res = await request(app)
      .get(`/api/v1/time-tracking/entries?userId=${org.coworker.id}`)
      .set('Authorization', org.employee.auth);

    // Either refuse outright, or silently scope back to self — never
    // return another worker's punches with their GPS coordinates.
    if (res.status === 200) {
      const userIds: string[] = res.body.data.map((e: { userId: string }) => e.userId);
      expect(userIds).not.toContain(org.coworker.id);
    } else {
      expect(res.status).toBe(403);
    }
  });

  it('lets a manager read a specific employee', async () => {
    const res = await request(app)
      .get(`/api/v1/time-tracking/entries?userId=${org.employee.id}`)
      .set('Authorization', org.manager.auth)
      .expect(200);

    const userIds: string[] = res.body.data.map((e: { userId: string }) => e.userId);
    expect(new Set(userIds)).toEqual(new Set([org.employee.id]));
  });
});

describe('tenant isolation', () => {
  it('never returns another organization rows', async () => {
    const other = await seedOrg('punch-flow-other');
    try {
      await request(app)
        .post('/api/v1/time-tracking/punch-in')
        .set('Authorization', other.employee.auth)
        .send({ clientGeneratedId: nextId(), timestamp: iso(new Date('2026-03-05T09:00:00.000Z')) })
        .expect(201);

      const res = await request(app)
        .get('/api/v1/time-tracking/entries')
        .set('Authorization', org.owner.auth)
        .expect(200);

      const userIds: string[] = res.body.data.map((e: { userId: string }) => e.userId);
      expect(userIds).not.toContain(other.employee.id);
    } finally {
      await dropOrg(other.id);
    }
  });
});
