/**
 * Onboarding a worker end to end.
 *
 * This is the flow that silently failed in production: an owner created
 * an employee without a password, the API minted a setup token, tried to
 * email it through a transport that delivers nothing, and the token
 * expired fifteen minutes later. The worker could never log in and the
 * owner had no way to find out.
 *
 * The tests below run with email delivery UNCONFIGURED — the same
 * condition as that production install — because that is precisely the
 * path that has to work.
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
import { INVITE_TOKEN_TTL_MINUTES } from '../../src/services/password-reset.service.js';
import { isEmailDeliveryConfigured } from '../../src/services/email.service.js';
import { loadEnv } from '../../src/config/env.js';

const app = testApp();
let org: SeededOrg;

beforeAll(async () => {
  await assertDbReady();
  org = await seedOrg('invite-flow');
});

afterAll(async () => {
  if (org) await dropOrg(org.id);
  await closePool();
});

let seq = 0;
const newEmail = (): string => `hire-${Date.now()}-${seq++}@${org.slug}.test`;

/** Pull the raw token out of a setup URL. */
function tokenOf(setupUrl: string): string {
  return decodeURIComponent(new URL(setupUrl).searchParams.get('token') ?? '');
}

describe('the environment these tests run in', () => {
  it('has email delivery switched off, like the affected install', () => {
    expect(isEmailDeliveryConfigured(loadEnv())).toBe(false);
  });
});

describe('inviting a worker with no password', () => {
  it('returns a usable setup link and admits the email was not sent', async () => {
    const email = newEmail();
    const res = await request(app)
      .post('/api/v1/admin/users')
      .set('Authorization', org.owner.auth)
      .send({ email, firstName: 'New', role: 'employee' })
      .expect(201);

    expect(res.body.data.setupUrl).toEqual(expect.stringContaining('/reset-password?token='));
    // The honest signal: nothing was delivered, so the owner must relay it.
    expect(res.body.data.emailDelivered).toBe(false);
    expect(res.body.data.inviteExpiresAt).toEqual(expect.any(String));
  });

  it('gives the link a week to live, not fifteen minutes', async () => {
    const res = await request(app)
      .post('/api/v1/admin/users')
      .set('Authorization', org.owner.auth)
      .send({ email: newEmail(), role: 'employee' })
      .expect(201);

    const ttlMinutes = (Date.parse(res.body.data.inviteExpiresAt) - Date.now()) / 60_000;
    expect(ttlMinutes).toBeGreaterThan(INVITE_TOKEN_TTL_MINUTES - 10);
    expect(ttlMinutes).toBeLessThanOrEqual(INVITE_TOKEN_TTL_MINUTES + 1);
  });

  it('lets the worker set a password with that link and then log in', async () => {
    const email = newEmail();
    const invite = await request(app)
      .post('/api/v1/admin/users')
      .set('Authorization', org.owner.auth)
      .send({ email, firstName: 'Dana', role: 'employee' })
      .expect(201);

    await request(app)
      .post('/auth/reset-password')
      .send({ token: tokenOf(invite.body.data.setupUrl), password: 'chosen-by-the-worker-1' })
      .expect(200);

    const login = await request(app)
      .post('/auth/login')
      .send({ email, password: 'chosen-by-the-worker-1' })
      .expect(200);
    expect(login.body.data.organizationId).toBe(org.id);

    // And the link is single-use.
    await request(app)
      .post('/auth/reset-password')
      .send({ token: tokenOf(invite.body.data.setupUrl), password: 'second-attempt-1' })
      .expect(422);
  });

  it('stores only the hash of the token, never the token itself', async () => {
    const invite = await request(app)
      .post('/api/v1/admin/users')
      .set('Authorization', org.owner.auth)
      .send({ email: newEmail(), role: 'employee' })
      .expect(201);

    const raw = tokenOf(invite.body.data.setupUrl);
    const rows = await queryAsSystem<{ count: string }>(
      `SELECT count(*)::text AS count FROM password_reset_tokens WHERE token_hash = $1`,
      [raw],
    );
    expect(Number(rows[0]!.count)).toBe(0);
  });
});

describe('inviting with an explicit password', () => {
  it('skips the setup link and the worker can log in immediately', async () => {
    const email = newEmail();
    const res = await request(app)
      .post('/api/v1/admin/users')
      .set('Authorization', org.owner.auth)
      .send({ email, password: 'set-by-the-owner-1', role: 'employee' })
      .expect(201);

    expect(res.body.data.setupUrl).toBeNull();

    await request(app)
      .post('/auth/login')
      .send({ email, password: 'set-by-the-owner-1' })
      .expect(200);
  });
});

describe('re-issuing an invite', () => {
  it('rescues a worker whose link was lost or expired', async () => {
    const email = newEmail();
    const first = await request(app)
      .post('/api/v1/admin/users')
      .set('Authorization', org.owner.auth)
      .send({ email, role: 'employee' })
      .expect(201);

    // Simulate the production situation: the only link is gone and dead.
    await queryAsSystem(
      `UPDATE password_reset_tokens SET expires_at = NOW() - INTERVAL '1 minute'
       WHERE user_id = $1`,
      [first.body.data.id],
    );
    await request(app)
      .post('/auth/reset-password')
      .send({ token: tokenOf(first.body.data.setupUrl), password: 'too-late-now-1' })
      .expect(422);

    const reissued = await request(app)
      .post(`/api/v1/admin/users/${first.body.data.id}/invite`)
      .set('Authorization', org.owner.auth)
      .expect(200);

    await request(app)
      .post('/auth/reset-password')
      .send({ token: tokenOf(reissued.body.data.setupUrl), password: 'second-chance-1' })
      .expect(200);

    await request(app).post('/auth/login').send({ email, password: 'second-chance-1' }).expect(200);
  });

  it('refuses to re-invite someone who already has a password', async () => {
    const res = await request(app)
      .post(`/api/v1/admin/users/${org.employee.id}/invite`)
      .set('Authorization', org.owner.auth)
      .expect(409);
    expect(res.body.error.message).toMatch(/already has a password/i);
  });

  it('is refused to an employee', async () => {
    await request(app)
      .post(`/api/v1/admin/users/${org.coworker.id}/invite`)
      .set('Authorization', org.employee.auth)
      .expect(403);
  });

  it('404s for a user in another organization', async () => {
    const other = await seedOrg('invite-other');
    try {
      const created = await request(app)
        .post('/api/v1/admin/users')
        .set('Authorization', other.owner.auth)
        .send({ email: `x-${Date.now()}@${other.slug}.test`, role: 'employee' })
        .expect(201);

      await request(app)
        .post(`/api/v1/admin/users/${created.body.data.id}/invite`)
        .set('Authorization', org.owner.auth)
        .expect(404);
    } finally {
      await dropOrg(other.id);
    }
  });
});

describe('manager limits', () => {
  it('lets a manager invite an employee and relay the link', async () => {
    const res = await request(app)
      .post('/api/v1/admin/users')
      .set('Authorization', org.manager.auth)
      .send({ email: newEmail(), role: 'employee' })
      .expect(201);
    expect(res.body.data.setupUrl).toEqual(expect.any(String));
  });

  it('stops a manager inviting a manager', async () => {
    await request(app)
      .post('/api/v1/admin/users')
      .set('Authorization', org.manager.auth)
      .send({ email: newEmail(), role: 'manager' })
      .expect(403);
  });
});
