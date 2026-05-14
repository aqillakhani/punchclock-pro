/**
 * Time-off helpers (Phase B).
 *
 * When a manager approves a time-off request, we materialize one
 * placeholder shift per affected date (shift_type='time_off',
 * 00:00–23:59) so that the schedule UI renders a PTO bar and any
 * future conflict detector (Phase D) finds the day already booked.
 *
 * `enumerateDates` is exposed for tests — it's a pure function and
 * the only piece of date math worth covering directly.
 */
import type { PoolClient } from 'pg';

/**
 * Returns every YYYY-MM-DD between `from` and `to` inclusive,
 * walking the dates in UTC so DST never inserts or skips a day.
 */
export function enumerateDates(from: string, to: string): string[] {
  const out: string[] = [];
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
    return out;
  }
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    out.push(`${y}-${m}-${day}`);
  }
  return out;
}

/**
 * Insert placeholder shifts for every date in the approved range.
 * Returns the count inserted. Skips dates the user already has a
 * shift on — we don't want two competing rows for the same date.
 */
export async function materializeTimeOffShifts(
  db: PoolClient,
  args: {
    organizationId: string;
    userId: string;
    startDate: string;
    endDate: string;
    requestId: string;
  },
): Promise<number> {
  const dates = enumerateDates(args.startDate, args.endDate);
  let inserted = 0;
  for (const date of dates) {
    const { rows: existing } = await db.query<{ id: string }>(
      `SELECT id FROM shifts
       WHERE user_id = $1 AND scheduled_date = $2 AND status <> 'cancelled'
       LIMIT 1`,
      [args.userId, date],
    );
    if (existing.length > 0) continue;
    await db.query(
      `INSERT INTO shifts
         (organization_id, user_id, scheduled_date, shift_start, shift_end,
          duration_minutes, shift_type, required_break_minutes, status, notes)
       VALUES ($1, $2, $3, '00:00', '23:59', 1439, 'time_off', 0, 'scheduled', $4)`,
      [args.organizationId, args.userId, date, `Time off (request ${args.requestId})`],
    );
    inserted += 1;
  }
  return inserted;
}
