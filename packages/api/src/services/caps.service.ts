/**
 * Hard daily/weekly hour caps (design §3c).
 *
 * The pure `evaluateCaps` decision function lives here so it stays
 * testable without touching `pino`, env config, or the database.
 *
 * The DB-side helpers (loading the user / org context, summing
 * minutes for today + this week) sit alongside it and are wired
 * into `time-tracking.service.ts#punchIn`.
 */
import type { PoolClient } from 'pg';
import { AppError } from '../lib/errors.js';

export type WorkerType = 'W2' | 'contractor_1099';
export type CapEnforcement = 'off' | 'warn' | 'block';

export interface CapEvaluationInput {
  workerType: WorkerType;
  enforcement: CapEnforcement;
  todayMinutes: number;
  weekMinutes: number;
  maxDailyMinutes: number;
  maxWeeklyMinutes: number;
  capExemptUntil: Date | null;
  now: Date;
}

export interface CapWarning {
  scope: 'daily' | 'weekly';
  cap: number;
  current: number;
  message: string;
}

export interface CapEvaluation {
  allowed: boolean;
  blockReason?: { scope: 'daily' | 'weekly'; cap: number; current: number };
  warnings: CapWarning[];
}

function formatHours(minutes: number): string {
  const h = minutes / 60;
  return Number.isInteger(h) ? String(h) : h.toFixed(1);
}

/**
 * Pure decision: given the org policy + the user's accumulated
 * minutes, should this punch-in be allowed and what (if anything)
 * should we warn about?
 *
 * Skipped for 1099 contractors — design §3b: dictating a contractor's
 * hours is a misclassification red flag and the FLSA does not apply.
 *
 * Skipped while `cap_exempt_until` is in the future — that's the
 * manager-override window for legitimate edge cases.
 */
export function evaluateCaps(input: CapEvaluationInput): CapEvaluation {
  if (input.workerType !== 'W2') return { allowed: true, warnings: [] };
  if (input.enforcement === 'off') return { allowed: true, warnings: [] };
  if (input.capExemptUntil && input.capExemptUntil.getTime() > input.now.getTime()) {
    return { allowed: true, warnings: [] };
  }

  const dailyExceeded = input.todayMinutes >= input.maxDailyMinutes;
  const weeklyExceeded = input.weekMinutes >= input.maxWeeklyMinutes;

  if (input.enforcement === 'block') {
    if (dailyExceeded) {
      return {
        allowed: false,
        blockReason: {
          scope: 'daily',
          cap: input.maxDailyMinutes,
          current: input.todayMinutes,
        },
        warnings: [],
      };
    }
    if (weeklyExceeded) {
      return {
        allowed: false,
        blockReason: {
          scope: 'weekly',
          cap: input.maxWeeklyMinutes,
          current: input.weekMinutes,
        },
        warnings: [],
      };
    }
    return { allowed: true, warnings: [] };
  }

  // Warn mode — emit warnings instead of blocking.
  const warnings: CapWarning[] = [];
  if (dailyExceeded) {
    warnings.push({
      scope: 'daily',
      cap: input.maxDailyMinutes,
      current: input.todayMinutes,
      message: `Daily ${formatHours(input.maxDailyMinutes)}-hour cap reached`,
    });
  }
  if (weeklyExceeded) {
    warnings.push({
      scope: 'weekly',
      cap: input.maxWeeklyMinutes,
      current: input.weekMinutes,
      message: `Weekly ${formatHours(input.maxWeeklyMinutes)}-hour cap reached`,
    });
  }
  return { allowed: true, warnings };
}

// ---- DB-side helpers used by the punch-in pipeline ----------------

export interface UserCapContext {
  workerType: WorkerType;
  capExemptUntil: Date | null;
}

export interface OrgCapContext {
  enforcement: CapEnforcement;
  maxDailyMinutes: number;
  maxWeeklyMinutes: number;
  timezone: string;
}

export interface AccumulatedMinutes {
  todayMinutes: number;
  weekMinutes: number;
}

export async function loadUserCapContext(db: PoolClient, userId: string): Promise<UserCapContext> {
  const { rows } = await db.query<{
    worker_type: WorkerType;
    cap_exempt_until: string | null;
  }>(`SELECT worker_type, cap_exempt_until FROM users WHERE id = $1`, [userId]);
  const row = rows[0];
  if (!row) throw AppError.notFound('User');
  return {
    workerType: row.worker_type,
    capExemptUntil: row.cap_exempt_until ? new Date(row.cap_exempt_until) : null,
  };
}

export async function loadOrgCapContext(db: PoolClient): Promise<OrgCapContext> {
  const { rows } = await db.query<{
    cap_enforcement: CapEnforcement;
    max_daily_minutes: number;
    max_weekly_minutes: number;
    timezone: string;
  }>(
    `SELECT cap_enforcement, max_daily_minutes, max_weekly_minutes, timezone
     FROM organizations LIMIT 1`,
  );
  const row = rows[0];
  if (!row) throw AppError.notFound('Organization');
  return {
    enforcement: row.cap_enforcement,
    maxDailyMinutes: Number(row.max_daily_minutes),
    maxWeeklyMinutes: Number(row.max_weekly_minutes),
    timezone: row.timezone ?? 'UTC',
  };
}

/**
 * Sum the user's completed minutes for "today" and "this week" in
 * the org's timezone. Postgres `date_trunc('week', …)` returns the
 * Monday of that week, matching the design's Mon–Sun definition.
 */
export async function loadAccumulatedMinutes(
  db: PoolClient,
  userId: string,
  orgTimezone: string,
): Promise<AccumulatedMinutes> {
  const { rows } = await db.query<{
    today_minutes: string;
    week_minutes: string;
  }>(
    `SELECT
       COALESCE(SUM(duration_minutes) FILTER (
         WHERE (punch_in_at AT TIME ZONE $2)::date = (NOW() AT TIME ZONE $2)::date
       ), 0)::text AS today_minutes,
       COALESCE(SUM(duration_minutes) FILTER (
         WHERE (punch_in_at AT TIME ZONE $2)::date >=
               (date_trunc('week', NOW() AT TIME ZONE $2))::date
       ), 0)::text AS week_minutes
     FROM time_entries
     WHERE user_id = $1 AND status = 'completed'`,
    [userId, orgTimezone],
  );
  const row = rows[0];
  return {
    todayMinutes: Number(row?.today_minutes ?? 0),
    weekMinutes: Number(row?.week_minutes ?? 0),
  };
}
