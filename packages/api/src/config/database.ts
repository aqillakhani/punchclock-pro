import pg from 'pg';
import { loadEnv } from './env.js';

const { Pool } = pg;

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (pool) return pool;
  const env = loadEnv();
  pool = new Pool({
    connectionString: env.DATABASE_URL,
    max: env.DATABASE_POOL_MAX,
    ssl: env.DATABASE_SSL ? { rejectUnauthorized: false } : undefined,
    idleTimeoutMillis: 30_000,
  });
  return pool;
}

/**
 * Run a callback inside a transaction with the tenant context set so
 * that row-level security policies apply to every statement.
 *
 * If `organizationId` is null, the `app.bypass_rls` GUC is set — use
 * this only for system jobs (migrations, webhooks, cron).
 */
export async function withTenantTx<T>(
  organizationId: string | null,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    if (organizationId === null) {
      await client.query("SELECT set_config('app.bypass_rls', 'on', true)");
    } else {
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [organizationId]);
    }
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
