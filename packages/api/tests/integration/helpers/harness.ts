/**
 * Integration-test harness.
 *
 * Unlike the unit suite (which pokes pure functions), these tests drive
 * the *real* Express app with supertest against a *real* Postgres —
 * so row-level security, the tenant transaction wrapper, Zod validation,
 * the permission gates, and the SQL itself are all exercised together.
 *
 * Requires a reachable Postgres with the schema migrated:
 *   docker compose up -d postgres && pnpm db:migrate
 *
 * Every test file gets its own organization (see `seedOrg`), so files can
 * run in parallel without truncating each other's rows.
 */
import type { Express } from 'express';
import bcrypt from 'bcrypt';
import { createApp } from '../../../src/app.js';
import { signAppJwt } from '../../../src/middleware/auth.js';
import { getPool, withTenantTx, closePool } from '../../../src/config/database.js';
import type { Role } from '@punchclock/shared';

export interface SeededUser {
  id: string;
  email: string;
  role: Role;
  token: string;
  /** `Authorization: Bearer …` header value, ready to hand to supertest. */
  auth: string;
}

export interface SeededOrg {
  id: string;
  slug: string;
  owner: SeededUser;
  manager: SeededUser;
  employee: SeededUser;
  /** A second employee — for cross-user authorization tests. */
  coworker: SeededUser;
}

let app: Express | null = null;

/** The Express app under test (built once per worker process). */
export function testApp(): Express {
  if (!app) app = createApp();
  return app;
}

/**
 * Create an isolated organization with one user per role.
 *
 * `slugPrefix` should be unique per test file so parallel files never
 * collide on the `organizations.slug` unique constraint.
 */
export async function seedOrg(slugPrefix: string): Promise<SeededOrg> {
  const slug = `${slugPrefix}-${Math.random().toString(36).slice(2, 10)}`;

  return withTenantTx(null, async (db) => {
    const { rows: orgRows } = await db.query<{ id: string }>(
      `INSERT INTO organizations (name, slug, timezone, geofencing_enabled, cap_enforcement)
       VALUES ($1, $2, 'UTC', FALSE, 'off')
       RETURNING id`,
      [`Test Org ${slug}`, slug],
    );
    const orgId = orgRows[0]!.id;

    // A single cheap hash reused for every seeded user — bcrypt at the
    // configured cost is the slowest thing in the whole harness.
    const passwordHash = await bcrypt.hash('test-password-1', 4);

    const makeUser = async (role: Role, label: string): Promise<SeededUser> => {
      const email = `${label}@${slug}.test`;
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO users
           (organization_id, email, first_name, last_name, password_hash, role, pay_rate, status)
         VALUES ($1, $2, $3, 'Test', $4, $5, 25.00, 'active')
         RETURNING id`,
        [orgId, email, label, passwordHash, role],
      );
      const id = rows[0]!.id;
      const token = signAppJwt({ userId: id, organizationId: orgId, role, email });
      return { id, email, role, token, auth: `Bearer ${token}` };
    };

    return {
      id: orgId,
      slug,
      owner: await makeUser('owner', 'owner'),
      manager: await makeUser('manager', 'manager'),
      employee: await makeUser('employee', 'employee'),
      coworker: await makeUser('employee', 'coworker'),
    };
  });
}

/** Delete an organization and everything that cascades from it. */
export async function dropOrg(orgId: string): Promise<void> {
  await withTenantTx(null, async (db) => {
    await db.query(`DELETE FROM organizations WHERE id = $1`, [orgId]);
  });
}

/**
 * Insert a completed time entry directly, bypassing the punch flow —
 * for tests that need an entry to *exist* without re-testing punching.
 */
export async function insertCompletedEntry(
  orgId: string,
  userId: string,
  punchInAt: string,
  punchOutAt: string,
): Promise<string> {
  return withTenantTx(null, async (db) => {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO time_entries
         (organization_id, user_id, punch_in_at, punch_out_at, duration_minutes, status)
       VALUES ($1, $2, $3, $4,
               GREATEST(0, EXTRACT(EPOCH FROM ($4::timestamptz - $3::timestamptz))::int / 60),
               'completed')
       RETURNING id`,
      [orgId, userId, punchInAt, punchOutAt],
    );
    return rows[0]!.id;
  });
}

/** Run a read against the DB outside RLS — for asserting on stored state. */
export async function queryAsSystem<T extends Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  return withTenantTx(null, async (db) => {
    const { rows } = await db.query<T>(sql, params);
    return rows;
  });
}

/** Verify the database is reachable and migrated; call in a global setup. */
export async function assertDbReady(): Promise<void> {
  const { rows } = await getPool().query<{ count: string }>(
    `SELECT count(*)::text AS count FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name IN
       ('organizations','users','time_entries','time_entry_events')`,
  );
  if (Number(rows[0]?.count ?? 0) < 4) {
    throw new Error(
      'Integration DB is not migrated. Run: docker compose up -d postgres && pnpm db:migrate',
    );
  }
}

export { closePool };
