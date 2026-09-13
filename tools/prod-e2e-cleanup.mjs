/**
 * Removes everything the production E2E suite creates.
 *
 *   flyctl proxy 15432:5432 -a punchclock-db        # in another shell
 *   node tools/prod-e2e-cleanup.mjs                 # add --dry-run to preview
 *
 * Only touches rows belonging to the `@punchclock.test` accounts, so it can
 * never remove real staff or real hours. Reads POSTGRES_PASSWORD from
 * ~/pcp-deploy-secrets.env (never from the repo).
 */
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const DRY = process.argv.includes('--dry-run');
const TEST_DOMAIN = '%@punchclock.test';

const secretsPath = join(homedir(), 'pcp-deploy-secrets.env');
const env = Object.fromEntries(
  readFileSync(secretsPath, 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const client = new pg.Client({
  host: '127.0.0.1',
  port: 15432,
  database: 'punchclock',
  user: 'punchclock',
  password: env.POSTGRES_PASSWORD,
  ssl: { rejectUnauthorized: false }, // self-signed cert on the Fly Postgres
});

await client.connect();

const { rows: victims } = await client.query(
  `SELECT id, email, role FROM users WHERE email LIKE $1 ORDER BY email`,
  [TEST_DOMAIN],
);

if (!victims.length) {
  console.log('No @punchclock.test accounts found — nothing to clean up.');
  await client.end();
  process.exit(0);
}

console.log(`${DRY ? '[dry run] would remove' : 'Removing'} ${victims.length} test account(s):`);
victims.forEach((v) => console.log(`  ${v.email.padEnd(38)} ${v.role}`));
const ids = victims.map((v) => v.id);

// Child rows first — some have ON DELETE CASCADE, but being explicit keeps the
// counts visible and does not depend on which constraints happen to cascade.
const steps = [
  ['break rows', `DELETE FROM breaks WHERE user_id = ANY($1)`],
  ['correction requests', `DELETE FROM time_correction_requests WHERE user_id = ANY($1) OR requested_by = ANY($1)`],
  ['time entries', `DELETE FROM time_entries WHERE user_id = ANY($1)`],
  ['time-off requests', `DELETE FROM time_off_requests WHERE user_id = ANY($1)`],
  ['shifts', `DELETE FROM shifts WHERE user_id = ANY($1)`],
  ['password reset / invite tokens', `DELETE FROM password_reset_tokens WHERE user_id = ANY($1)`],
  ['audit log rows', `DELETE FROM audit_logs WHERE actor_user_id = ANY($1)`],
  ['users', `DELETE FROM users WHERE id = ANY($1)`],
];

if (DRY) {
  for (const [label, sql] of steps) {
    const countSql = sql.replace(/^DELETE FROM (\w+)/, 'SELECT COUNT(*) AS n FROM $1');
    const { rows } = await client.query(countSql, [ids]);
    console.log(`  would delete ${String(rows[0].n).padStart(4)}  ${label}`);
  }
  console.log('\n[dry run] nothing was changed.');
} else {
  await client.query('BEGIN');
  try {
    for (const [label, sql] of steps) {
      const r = await client.query(sql, [ids]);
      console.log(`  deleted ${String(r.rowCount).padStart(4)}  ${label}`);
    }
    await client.query('COMMIT');
    console.log('\nDone.');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Rolled back:', e.message);
    process.exitCode = 1;
  }
}

// Anything still open that would block a real worker's next punch-in.
const { rows: stuck } = await client.query(
  `SELECT u.email, te.punch_in_at
     FROM time_entries te JOIN users u ON u.id = te.user_id
    WHERE te.punch_out_at IS NULL AND te.status = 'in_progress'`,
);
if (stuck.length) {
  console.log('\n⚠  Open shifts with no punch-out (these block that person from punching in again):');
  stuck.forEach((s) => console.log(`   ${s.email} — open since ${s.punch_in_at.toISOString()}`));
  console.log('   Fix in the app: Timesheets → edit the entry → set a punch-out time.');
}

await client.end();
