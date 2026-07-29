/**
 * Authentication under real row-level security.
 *
 * These flows are the reason the RLS fix is risky to deploy blind: login,
 * forgot-password and reset-password all have to find a user *before*
 * any organization context exists, so they cannot be scoped by
 * `app.current_org_id`. They rely on `withTenantTx(null, …)`, which opts
 * out via the `app.bypass_rls` GUC.
 *
 * If that opt-out did not work for the least-privilege application role,
 * switching production's DATABASE_URL would lock every user out of the
 * product. The rest of the suite signs JWTs directly and would never
 * catch it — so this file exercises the real endpoints.
 */
import request from 'supertest';
import bcrypt from 'bcrypt';
import {
  testApp,
  seedOrg,
  dropOrg,
  queryAsSystem,
  assertDbReady,
  closePool,
  type SeededOrg,
} from './helpers/harness.js';
import { getPool } from '../../src/config/database.js';

const app = testApp();
let org: SeededOrg;

beforeAll(async () => {
  await assertDbReady();
  org = await seedOrg('auth-rls');
});

afterAll(async () => {
  if (org) await dropOrg(org.id);
  await closePool();
});

describe('the connection really is restricted', () => {
  it('runs as a role that cannot bypass RLS', async () => {
    const { rows } = await getPool().query<{
      rolname: string;
      rolsuper: boolean;
      rolbypassrls: boolean;
    }>(`SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`);
    expect(rows[0]).toMatchObject({ rolsuper: false, rolbypassrls: false });
  });

  it('sees nothing without an org context set', async () => {
    // A bare pool query has neither current_org_id nor the bypass GUC.
    const { rows } = await getPool().query<{ count: string }>(
      `SELECT count(*)::text AS count FROM users`,
    );
    expect(Number(rows[0]!.count)).toBe(0);
  });
});

describe('login', () => {
  it('finds the user across organizations and returns a token', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email: org.employee.email, password: 'test-password-1' })
      .expect(200);

    expect(res.body.data.token).toEqual(expect.any(String));
    expect(res.body.data.userId).toBe(org.employee.id);
    expect(res.body.data.organizationId).toBe(org.id);
  });

  it('records last_login_at', async () => {
    await request(app)
      .post('/auth/login')
      .send({ email: org.manager.email, password: 'test-password-1' })
      .expect(200);

    const rows = await queryAsSystem<{ last_login_at: string | null }>(
      `SELECT last_login_at FROM users WHERE id = $1`,
      [org.manager.id],
    );
    expect(rows[0]!.last_login_at).not.toBeNull();
  });

  it('rejects a wrong password', async () => {
    await request(app)
      .post('/auth/login')
      .send({ email: org.employee.email, password: 'not-the-password' })
      .expect(401);
  });

  it('rejects an unknown email with the same status', async () => {
    await request(app)
      .post('/auth/login')
      .send({ email: 'nobody@nowhere.test', password: 'test-password-1' })
      .expect(401);
  });

  it('issues a token that actually works against a tenant-scoped route', async () => {
    const login = await request(app)
      .post('/auth/login')
      .send({ email: org.employee.email, password: 'test-password-1' })
      .expect(200);

    const me = await request(app)
      .get('/auth/me')
      .set('Authorization', `Bearer ${login.body.data.token}`)
      .expect(200);

    expect(me.body.data.email).toBe(org.employee.email);
    expect(me.body.data.organization_id).toBe(org.id);
  });
});

describe('password reset', () => {
  it('accepts a request for a real address and stores a token', async () => {
    await request(app)
      .post('/auth/forgot-password')
      .send({ email: org.employee.email })
      .expect(200);

    const rows = await queryAsSystem<{ count: string }>(
      `SELECT count(*)::text AS count FROM password_reset_tokens WHERE user_id = $1`,
      [org.employee.id],
    );
    expect(Number(rows[0]!.count)).toBeGreaterThan(0);
  });

  it('responds identically for an unknown address', async () => {
    const known = await request(app)
      .post('/auth/forgot-password')
      .send({ email: org.employee.email })
      .expect(200);
    const unknown = await request(app)
      .post('/auth/forgot-password')
      .send({ email: 'ghost@nowhere.test' })
      .expect(200);

    expect(unknown.body).toEqual(known.body);
  });

  it('completes a reset and lets the new password log in', async () => {
    // Mint a token directly — the raw value is only ever emailed.
    const raw = 'integration-reset-token-value-0123456789';
    const { createHash } = await import('node:crypto');
    const hash = createHash('sha256').update(raw).digest('hex');

    await queryAsSystem(
      `INSERT INTO password_reset_tokens (organization_id, user_id, token_hash, expires_at)
       VALUES ($1, $2, $3, NOW() + INTERVAL '15 minutes')`,
      [org.id, org.coworker.id, hash],
    );

    await request(app)
      .post('/auth/reset-password')
      .send({ token: raw, password: 'brand-new-password-9' })
      .expect(200);

    await request(app)
      .post('/auth/login')
      .send({ email: org.coworker.email, password: 'brand-new-password-9' })
      .expect(200);

    // Single use — the same token must not work twice.
    await request(app)
      .post('/auth/reset-password')
      .send({ token: raw, password: 'another-password-9' })
      .expect(422);
  });
});

describe('bootstrap signup', () => {
  it('is refused once an organization exists', async () => {
    await request(app)
      .post('/auth/signup')
      .send({
        organizationName: 'Should Not Be Created',
        ownerEmail: 'owner@should-not-exist.test',
        ownerPassword: 'a-password-that-is-long',
      })
      .expect(403);
  });
});

describe('invited user setup', () => {
  it('lets an owner create a user who can then log in', async () => {
    const email = `invited-${Date.now()}@${org.slug}.test`;
    await request(app)
      .post('/api/v1/admin/users')
      .set('Authorization', org.owner.auth)
      .send({ email, password: 'invited-password-1', firstName: 'Invited', role: 'employee' })
      .expect(201);

    const login = await request(app)
      .post('/auth/login')
      .send({ email, password: 'invited-password-1' })
      .expect(200);
    expect(login.body.data.organizationId).toBe(org.id);
  });
});

describe('bcrypt round-trip', () => {
  it('verifies the seeded hash the harness produced', async () => {
    // Guards against a harness/env mismatch making every login test
    // pass or fail for the wrong reason.
    const rows = await queryAsSystem<{ password_hash: string }>(
      `SELECT password_hash FROM users WHERE id = $1`,
      [org.employee.id],
    );
    expect(await bcrypt.compare('test-password-1', rows[0]!.password_hash)).toBe(true);
  });
});
