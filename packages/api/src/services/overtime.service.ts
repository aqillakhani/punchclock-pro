import { OVERTIME_RULES } from '@punchclock/shared';

export interface DailyHours {
  /** ISO date (YYYY-MM-DD) in the employee's timezone. */
  date: string;
  /** Raw worked hours for that day (before OT splitting). */
  hours: number;
}

export interface OvertimeBreakdown {
  regularHours: number;
  overtimeHours: number;
  doubleTimeHours: number;
}

export type OvertimeJurisdiction = 'federal' | 'california';

/**
 * Split a sequence of daily worked hours into regular, overtime, and
 * double-time buckets according to the given jurisdiction.
 *
 * Federal (FLSA):
 *   - Any hours over 40 in a week are 1.5x overtime.
 * California:
 *   - Over 8h per day: 1.5x
 *   - Over 12h per day: 2x (double time)
 *   - Over 40h per week (of non-OT/DT hours): 1.5x
 *
 * The caller supplies ONE week's worth of days. The function is pure
 * and easily unit tested.
 */
export function calculateOvertime(
  days: DailyHours[],
  jurisdiction: OvertimeJurisdiction = 'federal',
): OvertimeBreakdown {
  if (jurisdiction === 'california') return calculateCalifornia(days);
  return calculateFederal(days);
}

function calculateFederal(days: DailyHours[]): OvertimeBreakdown {
  const total = days.reduce((sum, d) => sum + d.hours, 0);
  const regular = Math.min(total, OVERTIME_RULES.FEDERAL_WEEKLY_THRESHOLD);
  const overtime = Math.max(0, total - OVERTIME_RULES.FEDERAL_WEEKLY_THRESHOLD);
  return { regularHours: regular, overtimeHours: overtime, doubleTimeHours: 0 };
}

function calculateCalifornia(days: DailyHours[]): OvertimeBreakdown {
  let regular = 0;
  let overtime = 0;
  let doubleTime = 0;

  for (const day of days) {
    const h = day.hours;
    if (h <= OVERTIME_RULES.CA_DAILY_OT_THRESHOLD) {
      regular += h;
    } else if (h <= OVERTIME_RULES.CA_DAILY_DOUBLE_THRESHOLD) {
      regular += OVERTIME_RULES.CA_DAILY_OT_THRESHOLD;
      overtime += h - OVERTIME_RULES.CA_DAILY_OT_THRESHOLD;
    } else {
      regular += OVERTIME_RULES.CA_DAILY_OT_THRESHOLD;
      overtime +=
        OVERTIME_RULES.CA_DAILY_DOUBLE_THRESHOLD - OVERTIME_RULES.CA_DAILY_OT_THRESHOLD;
      doubleTime += h - OVERTIME_RULES.CA_DAILY_DOUBLE_THRESHOLD;
    }
  }

  // Weekly OT applies only to "regular" hours over 40.
  if (regular > OVERTIME_RULES.CA_WEEKLY_OT_THRESHOLD) {
    const weeklyOt = regular - OVERTIME_RULES.CA_WEEKLY_OT_THRESHOLD;
    regular = OVERTIME_RULES.CA_WEEKLY_OT_THRESHOLD;
    overtime += weeklyOt;
  }

  return { regularHours: regular, overtimeHours: overtime, doubleTimeHours: doubleTime };
}
