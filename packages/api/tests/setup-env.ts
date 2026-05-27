/**
 * Jest setup (runs before each test file's imports). Guarantees the
 * required env vars exist so that modules which call `loadEnv()` at import
 * time (e.g. the logger) don't throw during unit tests. NODE_ENV is 'test'
 * here, so production hardening checks never fire.
 */
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.DATABASE_URL =
  process.env.DATABASE_URL || 'postgres://test:test@localhost:5432/punchclock_test';
