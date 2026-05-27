/**
 * Audit-log retention pruning.
 *
 * Pure date math + a single bulk DELETE. The runnable entry point lives in
 * `scripts/prune-audit-logs.ts` (invoked as a scheduled Fly machine), which
 * keeps this module import-safe for unit tests.
 */
import pg from 'pg';

/** The retention boundary: rows created before this are eligible for pruning. */
export function retentionCutoff(now: Date, retentionDays: number): Date {
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - retentionDays);
  return cutoff;
}

/**
 * Delete audit_logs older than each organization's configured retention
 * window (organizations.audit_logs_retention_days). Returns rows deleted.
 * Must run with RLS bypassed (system job): withTenantTx(null, pruneAuditLogs).
 */
export async function pruneAuditLogs(client: pg.PoolClient): Promise<number> {
  const result = await client.query(
    `DELETE FROM audit_logs a
     USING organizations o
     WHERE a.organization_id = o.id
       AND a.created_at < NOW() - (o.audit_logs_retention_days || ' days')::interval`,
  );
  return result.rowCount ?? 0;
}
