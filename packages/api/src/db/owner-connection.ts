/**
 * Schema-owner connection switch for the database CLIs.
 *
 * The running API connects as `punchclock_app`, a role with no
 * SUPERUSER and no BYPASSRLS, so row-level security actually applies to
 * it (see create-app-role.ts for why that matters). That role
 * deliberately has no DDL rights, so migrations, seeds and role
 * provisioning need the owner connection instead.
 *
 * Call this at the top of a CLI's main block — before anything calls
 * `getPool()`, which is what reads DATABASE_URL — to run that script as
 * the owner. If OWNER_DATABASE_URL is unset the connection is left
 * alone, which keeps single-role setups (like CI) working unchanged.
 */
import { logger } from '../config/logger.js';
import { resetEnvCache } from '../config/env.js';

export function useOwnerConnection(): void {
  const owner = process.env.OWNER_DATABASE_URL;
  if (!owner) return;
  if (process.env.DATABASE_URL === owner) return;
  process.env.DATABASE_URL = owner;
  // `loadEnv()` memoizes on first call, and importing the logger already
  // triggered it — so the swap only takes effect if the cache is dropped
  // before `getPool()` reads DATABASE_URL.
  resetEnvCache();
  logger.info('using OWNER_DATABASE_URL for this command (schema owner privileges)');
}
