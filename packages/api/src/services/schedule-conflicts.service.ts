/**
 * Schedule conflict detection for POST /shifts (design D4b).
 *
 * Three categories, in priority order:
 *
 *   - overlap    — another non-cancelled shift on the same date
 *                  whose [start, end) range intersects this one
 *   - weekly_cap — Mon–Sun scheduled minutes (this user, including
 *                  the proposed shift) would exceed
 *                  organizations.max_weekly_minutes
 *   - rest_period — fewer than `restWindowHours` between the user's
 *                  previous-shift end and this shift's start
 *
 * Pure decision; the route handler queries the inputs.
 */

export interface ProposedShift {
  scheduledDate: string; // YYYY-MM-DD
  shiftStart: string; // HH:mm
  shiftEnd: string; // HH:mm (may wrap into next day)
}

export interface ExistingShift {
  scheduledDate: string;
  shiftStart: string;
  shiftEnd: string;
  durationMinutes: number;
}

export interface ConflictInput {
  proposed: ProposedShift;
  existingOnDate: ExistingShift[]; // same user, same date, non-cancelled, excludes time_off
  weekScheduledMinutes: number; // user's Mon–Sun total (excluding this proposed shift, excluding cancelled, excluding time_off)
  maxWeeklyMinutes: number;
  /** End time of the user's most recent shift before `proposed`, or null. */
  previousShiftEndIso: string | null;
  /** Default 10h per common predictive scheduling rules. */
  restWindowHours?: number;
}

export interface ConflictResult {
  conflict: 'overlap' | 'weekly_cap' | 'rest_period' | null;
  message: string;
  details?: Record<string, unknown>;
}

export function evaluateScheduleConflict(input: ConflictInput): ConflictResult {
  // 1. Overlap on the same date
  const propStart = toMinutes(input.proposed.shiftStart);
  let propEnd = toMinutes(input.proposed.shiftEnd);
  if (propEnd <= propStart) propEnd += 24 * 60; // wraps midnight

  for (const ex of input.existingOnDate) {
    const exStart = toMinutes(ex.shiftStart);
    let exEnd = toMinutes(ex.shiftEnd);
    if (exEnd <= exStart) exEnd += 24 * 60;
    if (propStart < exEnd && exStart < propEnd) {
      return {
        conflict: 'overlap',
        message: `Overlaps with an existing shift (${ex.shiftStart}–${ex.shiftEnd}) on ${ex.scheduledDate}.`,
        details: { existing: ex },
      };
    }
  }

  // 2. Weekly cap
  const proposedMinutes = propEnd - propStart;
  const projectedWeek = input.weekScheduledMinutes + proposedMinutes;
  if (projectedWeek > input.maxWeeklyMinutes) {
    return {
      conflict: 'weekly_cap',
      message: `Would push the user's scheduled week to ${(projectedWeek / 60).toFixed(1)}h (cap ${(input.maxWeeklyMinutes / 60).toFixed(0)}h).`,
      details: { projectedMinutes: projectedWeek, capMinutes: input.maxWeeklyMinutes },
    };
  }

  // 3. Rest period (>= 10h between consecutive shifts)
  const window = (input.restWindowHours ?? 10) * 60 * 60_000; // ms
  if (input.previousShiftEndIso) {
    const prevEnd = new Date(input.previousShiftEndIso).getTime();
    const propStartIso = `${input.proposed.scheduledDate}T${input.proposed.shiftStart}:00Z`;
    const propStartMs = new Date(propStartIso).getTime();
    if (
      Number.isFinite(prevEnd) &&
      Number.isFinite(propStartMs) &&
      propStartMs - prevEnd < window
    ) {
      const hours = ((propStartMs - prevEnd) / 3600000).toFixed(1);
      return {
        conflict: 'rest_period',
        message: `Only ${hours}h rest after the previous shift (need ${input.restWindowHours ?? 10}h).`,
        details: { previousEnd: input.previousShiftEndIso, gapMs: propStartMs - prevEnd },
      };
    }
  }

  return { conflict: null, message: 'No conflict' };
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return h * 60 + m;
}
