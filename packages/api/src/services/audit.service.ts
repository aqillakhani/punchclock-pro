/**
 * Audit trail.
 *
 * Before this existed, `audit_logs` was written from exactly one place
 * (a forced predictive-scheduling override) — so the Audit log screen
 * was effectively blank and a wage-and-hour audit had nothing to read.
 *
 * Every mutation of a time record now lands here, in the SAME
 * transaction as the mutation itself. That is deliberate: a punch that
 * succeeds while its audit row silently fails is exactly the gap an
 * auditor is looking for. If we cannot record what happened, we do not
 * let it happen.
 *
 * `audit_logs` is a Timescale hypertable partitioned on created_at and
 * pruned by the retention job in `prune-audit-logs.ts`.
 */
import type { PoolClient } from 'pg';

/**
 * Actions worth reconstructing after the fact. Kept as a union rather
 * than free text so the Audit log screen can render a stable label per
 * action and so typos never create a silently unsearchable category.
 */
export const AUDIT_ACTIONS = {
  PUNCH_IN: 'punch_in',
  PUNCH_OUT: 'punch_out',
  BREAK_START: 'break_start',
  BREAK_END: 'break_end',

  CORRECTION_REQUESTED: 'correction_requested',
  CORRECTION_APPROVED: 'correction_approved',
  CORRECTION_REJECTED: 'correction_rejected',
  CORRECTION_CANCELLED: 'correction_cancelled',

  ENTRY_CREATED_MANUAL: 'entry_created_manual',
  ENTRY_EDITED: 'entry_edited',
  ENTRY_DELETED: 'entry_deleted',
  /** The system closed a forgotten punch — actor is null. */
  AUTO_CLOCK_OUT: 'auto_clock_out',

  PAY_PERIOD_LOCKED: 'pay_period_locked',
  PAY_PERIOD_UNLOCKED: 'pay_period_unlocked',

  USER_INVITED: 'user_invited',
  USER_DELETED: 'user_deleted',
  USER_ROLE_CHANGED: 'user_role_changed',
  ORG_SETTINGS_UPDATED: 'org_settings_updated',
  PAYROLL_EXPORTED: 'payroll_exported',
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

export type AuditResourceType =
  | 'time_entry'
  | 'time_correction_request'
  | 'break'
  | 'user'
  | 'organization'
  | 'pay_period'
  | 'payroll';

export interface AuditContext {
  /** Client IP, if the caller has one. Anything unparseable is dropped. */
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface LogAuditArgs extends AuditContext {
  organizationId: string;
  /** Null for system-initiated changes (cron, auto-clock-out). */
  actorUserId: string | null;
  resourceType: AuditResourceType;
  resourceId?: string | null;
  action: AuditAction;
  /**
   * What changed. For edits use `{ before: {...}, after: {...} }` so
   * the UI can render a diff without guessing.
   */
  changes?: Record<string, unknown> | null;
}

/**
 * Postgres `INET` rejects anything that is not an address, and Express
 * hands us `::ffff:127.0.0.1`, `undefined`, or a spoofed header string
 * depending on deployment. A malformed value must never be the reason a
 * worker cannot clock in, so we validate here and store NULL instead.
 */
export function normalizeIp(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const value = raw.trim();
  if (value.length === 0 || value.length > 45) return null;
  // IPv4, optionally IPv4-mapped IPv6 (::ffff:a.b.c.d).
  const v4 = /^(?:::ffff:)?((25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(25[0-5]|2[0-4]\d|1?\d?\d)$/;
  if (v4.test(value)) return value;
  // Loose IPv6: hex groups and colons only, at least one colon.
  if (/^[0-9a-fA-F:]+$/.test(value) && value.includes(':')) return value;
  return null;
}

export async function logAudit(db: PoolClient, args: LogAuditArgs): Promise<void> {
  await db.query(
    `INSERT INTO audit_logs
       (organization_id, actor_user_id, resource_type, resource_id,
        action, changes, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)`,
    [
      args.organizationId,
      args.actorUserId,
      args.resourceType,
      args.resourceId ?? null,
      args.action,
      args.changes ? JSON.stringify(args.changes) : null,
      normalizeIp(args.ipAddress),
      args.userAgent ? args.userAgent.slice(0, 1024) : null,
    ],
  );
}

/**
 * Build a `{ before, after }` diff containing only the keys that
 * actually changed — an audit row that restates every field makes the
 * one field that moved impossible to spot.
 */
export function diffChanges(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): { before: Record<string, unknown>; after: Record<string, unknown> } {
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (!Object.is(before[key], after[key])) {
      b[key] = before[key] ?? null;
      a[key] = after[key] ?? null;
    }
  }
  return { before: b, after: a };
}
