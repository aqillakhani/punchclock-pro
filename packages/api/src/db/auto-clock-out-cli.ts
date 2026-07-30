/**
 * Scheduled sweep that closes forgotten punches.
 *
 * Runs across every organization that has opted in
 * (`organizations.auto_clock_out_minutes IS NOT NULL`), so it needs RLS
 * bypassed — hence `withTenantTx(null, …)`, the same system-job context
 * the audit-log pruner uses.
 *
 * Invoke on a schedule (a Fly scheduled machine, or any cron):
 *   pnpm --filter @punchclock/api db:auto-clock-out
 *
 * Hourly is a sensible cadence: the close time is derived from
 * `punch_in + cap` rather than from when the job runs, so a late sweep
 * produces exactly the same result as a punctual one — it only delays
 * when the worker sees it.
 */
import '../config/load-env.js';
import { pathToFileURL } from 'node:url';
import { withTenantTx, closePool } from '../config/database.js';
import { logger } from '../config/logger.js';
import { runAutoClockOut } from '../services/auto-clock-out.service.js';

export async function autoClockOutJob(): Promise<number> {
  const result = await withTenantTx(null, (db) => runAutoClockOut(db));
  if (result.closed > 0) {
    logger.info(
      { closed: result.closed, entries: result.entries },
      'auto clock-out closed forgotten punches',
    );
  } else {
    logger.info('auto clock-out found nothing to close');
  }
  return result.closed;
}

const isMain = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (isMain) {
  autoClockOutJob()
    .then(() => closePool())
    .then(() => process.exit(0))
    .catch((err) => {
      logger.error({ err }, 'auto clock-out failed');
      closePool().finally(() => process.exit(1));
    });
}
