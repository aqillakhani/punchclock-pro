/**
 * Provision the least-privilege role the API connects as.
 *
 * WHY THIS EXISTS
 * ---------------
 * Tenant isolation in this app is enforced by Postgres row-level
 * security (migrations 002/003/007). RLS has one failure mode that is
 * completely silent: a role with SUPERUSER or BYPASSRLS skips every
 * policy, no error, no warning. The official `postgres` Docker image
 * creates `POSTGRES_USER` as a superuser — so pointing the API at that
 * user makes every `tenant_isolation` policy a no-op and every query
 * without its own `organization_id` predicate returns other tenants'
 * rows.
 *
 * This script creates a separate `punchclock_app` role that is
 * explicitly NOSUPERUSER NOBYPASSRLS, grants it exactly the DML it
 * needs, and leaves schema ownership (and therefore migrations) with
 * the bootstrap superuser.
 *
 *   Migrations / seeds → DATABASE_URL with the owner role
 *   The running API    → DATABASE_URL with punchclock_app
 *
 * Run it as the owner, after migrating:
 *   APP_DB_PASSWORD=... pnpm --filter @punchclock/api db:create-app-role
 *
 * Idempotent: safe to re-run, and re-running rotates the password.
 */
import '../config/load-env.js';
import { getPool, closePool } from '../config/database.js';
import { logger } from '../config/logger.js';
import { useOwnerConnection } from './owner-connection.js';

export const APP_ROLE = 'punchclock_app';

export async function createAppRole(password: string, roleName = APP_ROLE): Promise<void> {
  if (!password || password.length < 12) {
    throw new Error('APP_DB_PASSWORD must be at least 12 characters');
  }
  // Role names are not parameterizable; keep them to a safe charset.
  if (!/^[a-z_][a-z0-9_]*$/.test(roleName)) {
    throw new Error(`Unsafe role name: ${roleName}`);
  }

  const pool = getPool();
  const { rows: dbRows } = await pool.query<{ current_database: string }>(
    'SELECT current_database()',
  );
  const dbName = dbRows[0]!.current_database;

  // CREATE/ALTER ROLE take no bind parameters, so build the statement
  // server-side with format(%I/%L) — Postgres does the quoting, which is
  // safer than interpolating the password into a string here.
  const { rows: existing } = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1) AS exists`,
    [roleName],
  );
  const verb = existing[0]?.exists ? 'ALTER' : 'CREATE';
  const { rows: stmtRows } = await pool.query<{ stmt: string }>(
    `SELECT format('${verb} ROLE %I LOGIN PASSWORD %L', $1::text, $2::text) AS stmt`,
    [roleName, password],
  );
  await pool.query(stmtRows[0]!.stmt);

  // Belt and braces: even if someone later grants these, take them back.
  await pool.query(`ALTER ROLE ${roleName} NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`);

  await pool.query(`GRANT CONNECT ON DATABASE "${dbName}" TO ${roleName}`);
  await pool.query(`GRANT USAGE ON SCHEMA public TO ${roleName}`);
  await pool.query(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${roleName}`,
  );
  await pool.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${roleName}`);

  // Tables created by future migrations should be reachable too.
  await pool.query(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public
     GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${roleName}`,
  );
  await pool.query(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public
     GRANT USAGE, SELECT ON SEQUENCES TO ${roleName}`,
  );

  // The app must never hold DDL rights on the schema it queries.
  await pool.query(`REVOKE CREATE ON SCHEMA public FROM ${roleName}`);

  const { rows } = await pool.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
    `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = $1`,
    [roleName],
  );
  const role = rows[0];
  if (!role || role.rolsuper || role.rolbypassrls) {
    throw new Error(
      `${roleName} still has SUPERUSER/BYPASSRLS — row-level security would not apply`,
    );
  }

  logger.info(
    { role: roleName, database: dbName },
    'application role ready (NOSUPERUSER, NOBYPASSRLS) — point the API DATABASE_URL at it',
  );
}

const isMain = process.argv[1]?.endsWith('create-app-role.ts');
if (isMain) {
  // CREATE ROLE / GRANT need the schema owner.
  useOwnerConnection();
  const password = process.env.APP_DB_PASSWORD;
  if (!password) {
    logger.error('APP_DB_PASSWORD is required');
    process.exit(1);
  }
  createAppRole(password)
    .then(() => closePool())
    .then(() => process.exit(0))
    .catch((err) => {
      logger.error({ err }, 'failed to create application role');
      closePool().finally(() => process.exit(1));
    });
}
