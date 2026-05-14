/**
 * Pure meal-break compliance rules (design B6).
 *
 * Kept in its own file so the test suite can import `evaluateMealBreak`
 * without dragging in `pino`, env config, or the database.
 * `break.service.ts` re-exports the surface for production code.
 */

export type Worksite = 'onshore' | 'offshore';

export interface MealBreakInput {
  /** Minutes the worker was clocked in for this shift. */
  shiftMinutes: number;
  /** Total completed meal-break minutes during the shift. */
  mealBreakMinutes: number;
  /** Onshore workers fall under FLSA + state law; offshore 1099s do not. */
  worksite: Worksite;
  /** State-of-record heuristic — see design §B6. */
  orgTimezone: string;
}

export interface MealBreakWarning {
  code: 'missing_meal_break' | 'ca_meal_break_violation';
  message: string;
  requiredMinutes?: number;
  actualMinutes?: number;
}

export interface MealBreakEvaluation {
  warnings: MealBreakWarning[];
}

/**
 * Fired on punch-out.
 *
 * Universal: shifts over 6 hours that record no meal break at all
 * surface a soft warning. Useful for managers reviewing timesheets,
 * doesn't block the punch.
 *
 * California: anything ≥ 5 hours requires a 30-minute meal break
 * (Labor Code §512). We don't yet have a per-worker state field,
 * so we use the org's timezone as the proxy — `America/Los_Angeles`
 * triggers CA enforcement. Offshore workers are skipped entirely.
 */
export function evaluateMealBreak(input: MealBreakInput): MealBreakEvaluation {
  if (input.worksite !== 'onshore') return { warnings: [] };

  const warnings: MealBreakWarning[] = [];

  if (input.shiftMinutes > 360 && input.mealBreakMinutes <= 0) {
    warnings.push({
      code: 'missing_meal_break',
      message: 'No meal break recorded for a shift longer than 6 hours.',
    });
  }

  const isCalifornia = input.orgTimezone === 'America/Los_Angeles';
  if (isCalifornia && input.shiftMinutes >= 300 && input.mealBreakMinutes < 30) {
    warnings.push({
      code: 'ca_meal_break_violation',
      message: 'California requires a 30-minute meal break for shifts ≥ 5 hours.',
      requiredMinutes: 30,
      actualMinutes: input.mealBreakMinutes,
    });
  }

  return { warnings };
}
