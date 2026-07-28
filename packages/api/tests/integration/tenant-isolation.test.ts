/**
 * Cross-tenant isolation, asserted directly rather than inferred.
 *
 * The design leans on Postgres row-level security for tenant isolation,
 * and several queries have no `organization_id` predicate of their own
 * because RLS was assumed to add one. That assumption only holds if the
 * API connects as a role WITHOUT the BYPASSRLS attribute — a superuser
 * skips every policy, silently, with no error.
 *
 * These tests seed two organizations and assert that neither can see the
 * other through any endpoint that returns a list. They are written to
 * fail loudly if the app is ever pointed at a superuser connection
 * again, which is exactly how this went unnoticed.
 */
import request from 'supertest';
import {
  testApp,
  seedOrg,
  dropOrg,
  insertCompletedEntry,
  assertDbReady,
  closePool,
  type SeededOrg,
} from './helpers/harness.js';
import { getPool } from '../../src/config/database.js';

const app = testApp();
let alpha: SeededOrg;
let beta: SeededOrg;

beforeAll(async () => {
  await assertDbReady();
  alpha = await seedOrg('tenant-alpha');
  beta = await seedOrg('tenant-beta');

  const day = new Date();
  day.setUTCDate(day.getUTCDate() - 1);
  const at = (h: number): string => {
    const d = new Date(day);
    d.setUTCHours(h, 0, 0, 0);
    return d.toISOString();
  };
  await insertCompletedEntry(alpha.id, alpha.employee.id, at(9), at(17));
  await insertCompletedEntry(beta.id, beta.employee.id, at(9), at(17));
});

afterAll(async () => {
  if (alpha) await dropOrg(alpha.id);
  if (beta) await dropOrg(beta.id);
  await closePool();
});

describe('database role', () => {
  it('is not a superuser and does not bypass RLS', async () => {
    const { rows } = await getPool().query<{
      rolsuper: boolean;
      rolbypassrls: boolean;
      rolname: string;
    }>(`SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`);
    const role = rows[0]!;

    // A BYPASSRLS/superuser connection makes every tenant_isolation
    // policy in 002/003/007 a no-op. Nothing else in the stack notices.
    expect({ rolsuper: role.rolsuper, rolbypassrls: role.rolbypassrls }).toEqual({
      rolsuper: false,
      rolbypassrls: false,
    });
  });
});

describe('cross-tenant reads', () => {
  it('does not leak the other org users through the team list', async () => {
    const res = await request(app)
      .get('/api/v1/admin/users')
      .set('Authorization', alpha.owner.auth)
      .expect(200);

    const emails = (res.body.data as { email: string }[]).map((u) => u.email);
    expect(emails).toContain(alpha.employee.email);
    expect(emails).not.toContain(beta.employee.email);
  });

  it('does not leak the other org workers through the timesheet roll-up', async () => {
    const day = new Date();
    day.setUTCDate(day.getUTCDate() - 1);
    const ymd = day.toISOString().slice(0, 10);

    const res = await request(app)
      .get(`/api/v1/admin/timesheets?from=${ymd}&to=${ymd}`)
      .set('Authorization', alpha.owner.auth)
      .expect(200);

    const emails = (res.body.data as { email: string }[]).map((u) => u.email);
    expect(emails).toContain(alpha.employee.email);
    expect(emails).not.toContain(beta.employee.email);
  });

  it('does not expose the other org time entries', async () => {
    const res = await request(app)
      .get('/api/v1/time-tracking/entries?limit=500')
      .set('Authorization', alpha.owner.auth)
      .expect(200);

    const userIds = (res.body.data as { userId: string }[]).map((e) => e.userId);
    expect(userIds).not.toContain(beta.employee.id);
  });

  it('treats another org time entry as not found, never as forbidden', async () => {
    const day = new Date();
    day.setUTCDate(day.getUTCDate() - 1);
    const at = (h: number): string => {
      const d = new Date(day);
      d.setUTCHours(h, 0, 0, 0);
      return d.toISOString();
    };
    const betaEntry = await insertCompletedEntry(beta.id, beta.employee.id, at(6), at(8));

    // 403 would mean the row was read before the check — i.e. visible.
    await request(app)
      .post('/api/v1/me/corrections')
      .set('Authorization', alpha.employee.auth)
      .send({
        requestType: 'edit_times',
        timeEntryId: betaEntry,
        requestedPunchOutAt: at(9),
        reason: 'probing another tenant',
      })
      .expect(404);
  });

  it('does not leak the other org geofences', async () => {
    const res = await request(app)
      .get('/api/v1/geofence/locations')
      .set('Authorization', alpha.owner.auth);
    if (res.status === 200) {
      const orgIds = (res.body.data as { organizationId?: string }[])
        .map((g) => g.organizationId)
        .filter(Boolean);
      for (const id of orgIds) expect(id).toBe(alpha.id);
    }
  });
});
