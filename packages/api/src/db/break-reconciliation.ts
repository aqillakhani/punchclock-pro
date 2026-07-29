/**
 * Quantify the payroll impact of the unpaid-break fix — READ ONLY.
 *
 * `time_entries.duration_minutes` used to be raw wall-clock time, with
 * nothing subtracting unpaid breaks, so a 30-minute unpaid lunch was
 * paid. Migration 007 redefines the column as payable minutes and
 * backfills. That backfill *reduces reported hours* for anyone who
 * logged an unpaid break, which is a change worth seeing before it is
 * applied to a production database that payroll has already run against.
 *
 * This command writes nothing. It works on both the pre-migration
 * schema (computing what the backfill *would* do) and the post-migration
 * schema (reporting what it *did* do), so it is useful either side.
 *
 *   pnpm --filter @punchclock/api db:break-reconciliation
 *
 * Against production, tunnel first (see docs/security-rls-bypass.md):
 *   flyctl proxy 15432:5432 -a punchclock-db
 */
import '../config/load-env.js';
import { getPool, closePool } from '../config/database.js';
import { logger } from '../config/logger.js';
import { useOwnerConnection } from './owner-connection.js';

interface PerWorker {
  email: string;
  organization: string;
  entries_affected: string;
  minutes_removed: string;
}

export interface ReconciliationReport {
  migrated: boolean;
  totalEntries: number;
  affectedEntries: number;
  minutesRemoved: number;
  perWorker: PerWorker[];
}

async function hasColumn(table: string, column: string): Promise<boolean> {
  const { rows } = await getPool().query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2
     ) AS exists`,
    [table, column],
  );
  return rows[0]?.exists ?? false;
}

export async function buildReport(): Promise<ReconciliationReport> {
  const migrated = await hasColumn('time_entries', 'unpaid_break_minutes');
  const pool = getPool();

  // Post-migration the answer is stored; pre-migration we derive it from
  // the breaks table exactly the way the migration's backfill does.
  const unpaidExpr = migrated
    ? 'te.unpaid_break_minutes'
    : `COALESCE((
         SELECT SUM(b.duration_minutes)::int FROM breaks b
         WHERE b.time_entry_id = te.id
           AND b.status = 'completed'
           AND b.break_type IN ('lunch', 'unpaid')
       ), 0)`;

  const { rows: totals } = await pool.query<{
    total: string;
    affected: string;
    minutes: string;
  }>(
    `SELECT count(*)::text AS total,
            count(*) FILTER (WHERE ${unpaidExpr} > 0)::text AS affected,
            COALESCE(SUM(${unpaidExpr}), 0)::text AS minutes
     FROM time_entries te
     WHERE te.status = 'completed'`,
  );

  const { rows: perWorker } = await pool.query<PerWorker>(
    `SELECT u.email,
            o.name AS organization,
            count(*)::text AS entries_affected,
            SUM(${unpaidExpr})::text AS minutes_removed
     FROM time_entries te
     JOIN users u ON u.id = te.user_id
     JOIN organizations o ON o.id = te.organization_id
     WHERE te.status = 'completed' AND ${unpaidExpr} > 0
     GROUP BY u.email, o.name
     ORDER BY SUM(${unpaidExpr}) DESC
     LIMIT 100`,
  );

  return {
    migrated,
    totalEntries: Number(totals[0]?.total ?? 0),
    affectedEntries: Number(totals[0]?.affected ?? 0),
    minutesRemoved: Number(totals[0]?.minutes ?? 0),
    perWorker,
  };
}

export function formatReport(report: ReconciliationReport): string {
  const hours = (m: number): string => (m / 60).toFixed(2);
  const lines: string[] = [];

  lines.push('');
  lines.push('Unpaid-break reconciliation');
  lines.push('===========================');
  lines.push(
    report.migrated
      ? 'Schema: migration 007 IS applied — this is what the backfill already did.'
      : 'Schema: migration 007 is NOT applied — this is what the backfill WILL do.',
  );
  lines.push('');
  lines.push(`Completed time entries : ${report.totalEntries}`);
  lines.push(`Entries with an unpaid break: ${report.affectedEntries}`);
  lines.push(
    `Hours removed from payable time: ${hours(report.minutesRemoved)}h (${report.minutesRemoved} min)`,
  );
  lines.push('');

  if (report.perWorker.length === 0) {
    lines.push('No completed entry has an unpaid break recorded against it.');
    lines.push('Nothing changes: no reported total moves.');
    return lines.join('\n');
  }

  const emailWidth = Math.max(5, ...report.perWorker.map((r) => r.email.length));
  const orgWidth = Math.max(12, ...report.perWorker.map((r) => r.organization.length));
  lines.push(
    `${'EMAIL'.padEnd(emailWidth)}  ${'ORGANIZATION'.padEnd(orgWidth)}  ENTRIES  HOURS REMOVED`,
  );
  lines.push('-'.repeat(emailWidth + orgWidth + 26));
  for (const r of report.perWorker) {
    lines.push(
      `${r.email.padEnd(emailWidth)}  ${r.organization.padEnd(orgWidth)}  ` +
        `${r.entries_affected.padStart(7)}  ${hours(Number(r.minutes_removed)).padStart(13)}`,
    );
  }
  lines.push('');
  lines.push(
    'These workers were previously paid for unpaid break time. After the fix their',
    'reported hours drop by the amounts above. Nothing else about their records changes.',
  );
  return lines.join('\n');
}

const isMain = process.argv[1]?.endsWith('break-reconciliation.ts');
if (isMain) {
  useOwnerConnection();
  buildReport()
    .then((report) => {
      // eslint-disable-next-line no-console -- this command's output IS the deliverable
      console.log(formatReport(report));
      return closePool();
    })
    .then(() => process.exit(0))
    .catch((err) => {
      logger.error({ err }, 'reconciliation failed');
      closePool().finally(() => process.exit(1));
    });
}
