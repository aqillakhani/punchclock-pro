/**
 * Auto clock-out for forgotten punches.
 *
 * A worker who forgets to clock out otherwise leaves an entry open
 * indefinitely. That is not merely untidy: the partial unique index
 * `uniq_time_entries_open_per_user` allows one open entry per person, so
 * their NEXT shift cannot be punched in at all until somebody intervenes
 * — and until this feature existed, nobody could, because there was no
 * edit path.
 *
 * WHERE THE CLOCK STOPS
 * ---------------------
 * The entry is closed at `punch_in + auto_clock_out_minutes`, not at the
 * moment the sweep happens. Closing "now" would pay for every hour
 * between the forgotten punch and whenever the job next ran, which is
 * arbitrary and always too generous. Capping at the configured maximum
 * is defensible, reproducible, and does not depend on job timing.
 *
 * The entry is flagged `auto_closed` so the worker can see the system
 * guessed, and file a correction with the real time — which is exactly
 * what the correction workflow is for.
 *
 * OFF BY DEFAULT. `auto_clock_out_minutes` is NULL until an owner opts
 * in, because switching this on changes what people get paid.
 */
import type { PoolClient } from 'pg';
import { EVENT_TYPES } from '@punchclock/shared';
import { publishTimeEvent } from '../events/publisher.js';
import { AUDIT_ACTIONS, logAudit } from './audit.service.js';
import { closeOpenBreaks, loadUnpaidBreakMinutes } from './break.service.js';

export interface StaleEntry {
  id: string;
  organization_id: string;
  user_id: string;
  punch_in_at: string;
  auto_clock_out_minutes: number;
}

export interface AutoClockOutResult {
  closed: number;
  entries: { id: string; userId: string; punchOutAt: string; payableMinutes: number }[];
}

/**
 * The instant an entry should be closed at, given when it opened and the
 * organization's cap. Pure so the boundary is unit-testable.
 */
export function autoClockOutAt(punchInAt: string | Date, capMinutes: number): Date {
  const start = punchInAt instanceof Date ? punchInAt : new Date(punchInAt);
  return new Date(start.getTime() + capMinutes * 60_000);
}

/**
 * Entries that have been open longer than their organization's cap.
 *
 * Joined against `organizations` so each row carries its own cap: the
 * sweep runs across all tenants and each may configure a different one.
 * Organizations with the feature off (NULL) are excluded by the join.
 */
export async function findStaleOpenEntries(
  db: PoolClient,
  now: Date,
  limit = 500,
): Promise<StaleEntry[]> {
  const { rows } = await db.query<StaleEntry>(
    `SELECT te.id, te.organization_id, te.user_id,
            te.punch_in_at, o.auto_clock_out_minutes
     FROM time_entries te
     JOIN organizations o ON o.id = te.organization_id
     WHERE te.punch_out_at IS NULL
       AND te.status = 'in_progress'
       AND o.auto_clock_out_minutes IS NOT NULL
       AND o.deleted_at IS NULL
       AND te.punch_in_at <= $1::timestamptz - (o.auto_clock_out_minutes || ' minutes')::interval
     ORDER BY te.punch_in_at ASC
     LIMIT $2`,
    [now.toISOString(), limit],
  );
  return rows;
}

/**
 * Close one stale entry. Mirrors `punchOut` — breaks closed first, then
 * gross/unpaid/payable minutes computed the same way — so an
 * auto-closed entry is indistinguishable from a normal one to payroll,
 * apart from the `auto_closed` flag and the audit row.
 */
export async function closeStaleEntry(
  db: PoolClient,
  entry: StaleEntry,
): Promise<{ punchOutAt: string; payableMinutes: number } | null> {
  const punchOutAt = autoClockOutAt(entry.punch_in_at, entry.auto_clock_out_minutes).toISOString();

  await closeOpenBreaks(db, entry.id, punchOutAt);
  const unpaidBreakMinutes = await loadUnpaidBreakMinutes(db, entry.id);

  const { rows } = await db.query<{ duration_minutes: number; punch_out_at: string }>(
    `UPDATE time_entries
     SET punch_out_at = $2,
         gross_minutes = GREATEST(0,
           EXTRACT(EPOCH FROM ($2::timestamptz - punch_in_at))::int / 60),
         unpaid_break_minutes = $3,
         duration_minutes = GREATEST(0,
           EXTRACT(EPOCH FROM ($2::timestamptz - punch_in_at))::int / 60 - $3),
         status = 'completed',
         auto_closed = TRUE,
         notes = COALESCE(notes || ' — ', '') ||
                 'Automatically clocked out after the maximum shift length. Request a correction if this is wrong.',
         updated_at = NOW()
     WHERE id = $1 AND punch_out_at IS NULL AND status = 'in_progress'
     RETURNING duration_minutes, punch_out_at`,
    [entry.id, punchOutAt, unpaidBreakMinutes],
  );
  // Lost a race with a real punch-out — that is the better outcome, leave it.
  if (rows.length === 0) return null;

  await publishTimeEvent(db, {
    organizationId: entry.organization_id,
    userId: entry.user_id,
    // No actor: the system did this, not a person.
    actorUserId: null,
    eventType: EVENT_TYPES.PUNCH_OUT,
    eventData: {
      autoClosed: true,
      capMinutes: entry.auto_clock_out_minutes,
      punchInAt: entry.punch_in_at,
      punchOutAt,
    },
    timeEntryId: entry.id,
    recordedAt: new Date(punchOutAt),
  });

  await logAudit(db, {
    organizationId: entry.organization_id,
    actorUserId: null,
    resourceType: 'time_entry',
    resourceId: entry.id,
    action: AUDIT_ACTIONS.AUTO_CLOCK_OUT,
    changes: {
      subjectUserId: entry.user_id,
      punchInAt: entry.punch_in_at,
      punchOutAt,
      capMinutes: entry.auto_clock_out_minutes,
      payableMinutes: rows[0]!.duration_minutes,
    },
  });

  return { punchOutAt, payableMinutes: rows[0]!.duration_minutes };
}

/**
 * One sweep. Runs with RLS bypassed (system job, all tenants):
 *   withTenantTx(null, (db) => runAutoClockOut(db, new Date()))
 */
export async function runAutoClockOut(
  db: PoolClient,
  now = new Date(),
): Promise<AutoClockOutResult> {
  const stale = await findStaleOpenEntries(db, now);
  const entries: AutoClockOutResult['entries'] = [];

  for (const entry of stale) {
    const closed = await closeStaleEntry(db, entry);
    if (closed) {
      entries.push({
        id: entry.id,
        userId: entry.user_id,
        punchOutAt: closed.punchOutAt,
        payableMinutes: closed.payableMinutes,
      });
    }
  }

  return { closed: entries.length, entries };
}
