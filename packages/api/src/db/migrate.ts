/**
 * Naive forward-only migration runner.
 *
 * Reads every `.sql` file under `src/db/migrations` in lexical order and
 * applies any that have not already been recorded in `schema_migrations`.
 * Each file is executed inside a single transaction with RLS bypassed.
 */
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';
import { getPool, withTenantTx, closePool } from '../config/database.js';
import { logger } from '../config/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, 'migrations');

async function ensureMigrationsTable(): Promise<void> {
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function appliedMigrations(): Promise<Set<string>> {
  const { rows } = await getPool().query<{ filename: string }>(
    'SELECT filename FROM schema_migrations',
  );
  return new Set(rows.map((r) => r.filename));
}

async function runMigration(filename: string): Promise<void> {
  const sql = await readFile(join(MIGRATIONS_DIR, filename), 'utf8');
  await withTenantTx(null, async (client) => {
    await client.query(sql);
    await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [filename]);
  });
  logger.info({ filename }, 'migration applied');
}

export async function migrate(): Promise<void> {
  await ensureMigrationsTable();
  const applied = await appliedMigrations();
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    if (applied.has(file)) continue;
    await runMigration(file);
  }
}

// Executed directly (via `pnpm db:migrate`).
const isMain = import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`;
if (isMain) {
  migrate()
    .then(() => closePool())
    .then(() => process.exit(0))
    .catch((err) => {
      logger.error({ err }, 'migration failed');
      closePool().finally(() => process.exit(1));
    });
}
