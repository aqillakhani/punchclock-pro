/**
 * Pay periods and locking.
 *
 * A locked period is the product's promise that payroll for those dates
 * is settled: no approved correction, no manager edit, and no deletion
 * may change the hours inside it afterwards. Without that, a correction
 * approved a week later silently contradicts a payroll run that has
 * already been paid out.
 *
 * Boundaries are DERIVED from the organization's schedule rather than
 * materialized by a job, so there is nothing to fall behind or backfill.
 * `pay_periods` holds a row only once a period has been locked; the
 * absence of a row means open.
 *
 * All dates here are plain YYYY-MM-DD in the ORGANIZATION'S timezone —
 * a shift that starts 23:00 local belongs to the local date, not UTC.
 */
import type { PoolClient } from 'pg';
import { AppError } from '../lib/errors.js';

export type PayPeriodType = 'weekly' | 'biweekly' | 'semimonthly' | 'monthly';

export interface PayPeriodConfig {
  type: PayPeriodType;
  /** Any date known to be the FIRST day of a period. */
  anchor: string;
}

export interface PayPeriod {
  startDate: string;
  endDate: string;
}

// ---- Pure date helpers (UTC arithmetic on calendar dates) ------------
// Date-only maths is done at UTC midnight so a DST transition can never
// add or drop a day.

function toUtc(ymd: string): Date {
  const d = new Date(`${ymd}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid date: ${ymd}`);
  return d;
}

function fmt(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(ymd: string, n: number): string {
  const d = toUtc(ymd);
  d.setUTCDate(d.getUTCDate() + n);
  return fmt(d);
}

function daysBetween(from: string, to: string): number {
  return Math.round((toUtc(to).getTime() - toUtc(from).getTime()) / 86_400_000);
}

function lastDayOfMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

/**
 * The pay period containing `date`.
 *
 * Weekly/biweekly step in fixed-length blocks from the anchor, and work
 * for dates *before* the anchor too (a negative block index), so an
 * organization configured today can still lock last month.
 *
 * Semimonthly splits each month at the 16th; monthly is the calendar
 * month. Both ignore the anchor, since their boundaries are absolute.
 */
export function payPeriodFor(date: string, config: PayPeriodConfig): PayPeriod {
  const d = toUtc(date);

  if (config.type === 'monthly') {
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth();
    return {
      startDate: fmt(new Date(Date.UTC(y, m, 1))),
      endDate: fmt(new Date(Date.UTC(y, m, lastDayOfMonth(y, m)))),
    };
  }

  if (config.type === 'semimonthly') {
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth();
    const day = d.getUTCDate();
    return day <= 15
      ? { startDate: fmt(new Date(Date.UTC(y, m, 1))), endDate: fmt(new Date(Date.UTC(y, m, 15))) }
      : {
          startDate: fmt(new Date(Date.UTC(y, m, 16))),
          endDate: fmt(new Date(Date.UTC(y, m, lastDayOfMonth(y, m)))),
        };
  }

  const length = config.type === 'weekly' ? 7 : 14;
  const offset = daysBetween(config.anchor, date);
  // Math.floor (not truncation) so dates before the anchor land in the
  // correct earlier block rather than collapsing onto the anchor itself.
  const blockIndex = Math.floor(offset / length);
  const startDate = addDays(config.anchor, blockIndex * length);
  return { startDate, endDate: addDays(startDate, length - 1) };
}

/** The `count` most recent periods, newest first, including the current one. */
export function recentPayPeriods(
  today: string,
  config: PayPeriodConfig,
  count: number,
): PayPeriod[] {
  const out: PayPeriod[] = [];
  let cursor = today;
  for (let i = 0; i < count; i++) {
    const period = payPeriodFor(cursor, config);
    out.push(period);
    cursor = addDays(period.startDate, -1);
  }
  return out;
}

// ---- Database side ---------------------------------------------------

export interface OrgPayPeriodContext extends PayPeriodConfig {
  timezone: string;
}

export async function loadPayPeriodContext(db: PoolClient): Promise<OrgPayPeriodContext> {
  const { rows } = await db.query<{
    timezone: string;
    pay_period_type: PayPeriodType;
    pay_period_anchor_date: string;
  }>(
    `SELECT timezone, pay_period_type,
            to_char(pay_period_anchor_date, 'YYYY-MM-DD') AS pay_period_anchor_date
     FROM organizations LIMIT 1`,
  );
  const row = rows[0];
  if (!row) throw AppError.notFound('Organization');
  return {
    timezone: row.timezone,
    type: row.pay_period_type,
    anchor: row.pay_period_anchor_date,
  };
}

/**
 * Refuse the operation when any of the given instants falls in a locked
 * period.
 *
 * Every retroactive write path funnels through here: correction requests,
 * correction approvals, and the manager's direct create/edit/delete. Both
 * the old and the new timestamps are checked on an edit, so an entry can
 * neither be moved *out of* nor *into* a locked period.
 *
 * Live punching is deliberately NOT gated — trapping a worker on the
 * clock because an admin locked the current period would be worse than
 * the accounting problem it protects against.
 */
export async function assertNotInLockedPeriod(
  db: PoolClient,
  instants: (string | Date | null | undefined)[],
  context?: OrgPayPeriodContext,
): Promise<void> {
  const present = instants
    .filter((v): v is string | Date => v !== null && v !== undefined)
    .map((v) => (v instanceof Date ? v.toISOString() : v));
  if (present.length === 0) return;

  const ctx = context ?? (await loadPayPeriodContext(db));

  // One round trip for the whole set: convert each instant to its local
  // date and look for a locked period covering any of them. Doing this
  // per-timestamp meant nine queries for a single entry edit.
  const { rows } = await db.query<{ d: string; start_date: string; end_date: string }>(
    `SELECT to_char((t AT TIME ZONE $2)::date, 'YYYY-MM-DD') AS d,
            to_char(p.start_date, 'YYYY-MM-DD') AS start_date,
            to_char(p.end_date,   'YYYY-MM-DD') AS end_date
     FROM unnest($1::timestamptz[]) AS t
     JOIN pay_periods p
       ON p.status = 'locked'
      AND (t AT TIME ZONE $2)::date BETWEEN p.start_date AND p.end_date
     LIMIT 1`,
    [present, ctx.timezone],
  );

  const hit = rows[0];
  if (hit) {
    throw AppError.conflict(
      `Pay period ${hit.start_date} to ${hit.end_date} is locked, so ${hit.d} can no longer be changed. An owner can unlock it if this needs correcting.`,
    );
  }
}

export interface PayPeriodSummary extends PayPeriod {
  status: 'open' | 'locked';
  lockedAt: string | null;
  lockedBy: string | null;
  lockedByName: string | null;
  note: string | null;
  totalHours: number;
  workerCount: number;
  isCurrent: boolean;
}

/**
 * Recent periods with their lock state and the hours they contain, for
 * the payroll screen. Hours come from the same `duration_minutes` the
 * timesheets and payroll export use, so the number an owner locks
 * against is the number they were shown.
 */
export async function listPayPeriods(
  db: PoolClient,
  opts: { count?: number; today?: string } = {},
): Promise<PayPeriodSummary[]> {
  const ctx = await loadPayPeriodContext(db);
  const today =
    opts.today ??
    (
      await db.query<{ d: string }>(
        `SELECT to_char((NOW() AT TIME ZONE $1)::date, 'YYYY-MM-DD') AS d`,
        [ctx.timezone],
      )
    ).rows[0]!.d;

  const periods = recentPayPeriods(today, ctx, Math.min(Math.max(opts.count ?? 8, 1), 36));
  const current = payPeriodFor(today, ctx);

  const { rows: stored } = await db.query<{
    start_date: string;
    end_date: string;
    status: 'open' | 'locked';
    locked_at: string | null;
    locked_by: string | null;
    locked_by_name: string | null;
    note: string | null;
  }>(
    `SELECT to_char(p.start_date, 'YYYY-MM-DD') AS start_date,
            to_char(p.end_date,   'YYYY-MM-DD') AS end_date,
            p.status, p.locked_at, p.locked_by, p.note,
            NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), '') AS locked_by_name
     FROM pay_periods p
     LEFT JOIN users u ON u.id = p.locked_by`,
  );
  const storedByStart = new Map(stored.map((r) => [r.start_date, r]));

  // Per (day, worker) so a period can total its minutes AND count the
  // distinct people in it. Bounded to the window actually being shown.
  const earliest = periods[periods.length - 1]?.startDate ?? today;
  const latest = periods[0]?.endDate ?? today;
  const { rows: totals } = await db.query<{
    day: string;
    user_id: string;
    minutes: string;
  }>(
    `SELECT to_char((punch_in_at AT TIME ZONE $1)::date, 'YYYY-MM-DD') AS day,
            user_id,
            COALESCE(SUM(duration_minutes), 0)::text AS minutes
     FROM time_entries
     WHERE status = 'completed'
       AND punch_in_at >= ($2::date) AT TIME ZONE $1
       AND punch_in_at <  (($3::date) + INTERVAL '1 day') AT TIME ZONE $1
     GROUP BY day, user_id`,
    [ctx.timezone, earliest, latest],
  );

  return periods.map((period) => {
    const row = storedByStart.get(period.startDate);
    let minutes = 0;
    const workers = new Set<string>();
    for (const t of totals) {
      if (t.day >= period.startDate && t.day <= period.endDate) {
        minutes += Number(t.minutes);
        workers.add(t.user_id);
      }
    }
    return {
      ...period,
      status: row?.status ?? 'open',
      lockedAt: row?.locked_at ?? null,
      lockedBy: row?.locked_by ?? null,
      lockedByName: row?.locked_by_name ?? null,
      note: row?.note ?? null,
      totalHours: minutes / 60,
      workerCount: workers.size,
      isCurrent: period.startDate === current.startDate,
    };
  });
}
