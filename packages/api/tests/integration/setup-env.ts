/**
 * Env bootstrap for the integration suite.
 *
 * Defaults point at the docker-compose Postgres from the repo root.
 * Override DATABASE_URL to run against any other migrated database.
 */
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
// Connect as the least-privilege application role, NOT the bootstrap
// superuser — a SUPERUSER/BYPASSRLS connection silently disables every
// row-level-security policy, so testing as one would prove nothing about
// tenant isolation. Provision it with:
//   APP_DB_PASSWORD=... pnpm --filter @punchclock/api db:create-app-role
// (The harness seeds across organizations via withTenantTx(null), which
// opts out through the `app.bypass_rls` GUC rather than a role grant, so
// it still works on this connection.)
process.env.DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgres://punchclock_app:local-dev-app-password@localhost:5432/punchclock';
// Deterministic secret so signAppJwt() and verifyAppJwt() agree across the
// harness and the app under test.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-secret-not-for-production';
// Keep bcrypt cheap — these tests hash a handful of passwords per file.
process.env.BCRYPT_ROUNDS = process.env.BCRYPT_ROUNDS || '4';
// Never attempt real delivery from a test.
process.env.EMAIL_PROVIDER = 'log';
// pino-http logs every request; at ~1KB of JSON each that buries the
// Jest reporter. Set LOG_LEVEL=info to see them when debugging a failure.
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'fatal';
