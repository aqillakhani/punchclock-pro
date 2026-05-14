/**
 * Predictive scheduling 14-day lock (design §C5).
 *
 * Several jurisdictions (Oregon statewide; San Francisco, Berkeley,
 * LA, NYC, Philadelphia, Chicago, Seattle) require ≥ 14 days advance
 * notice for retail / fast-food shift changes. Owners opt in via the
 * `feature_predictive_scheduling` flag; once on, the API refuses
 * shift inserts and deletes within the 14-day window unless the
 * caller explicitly forces with an audit-logged override.
 *
 * The pure decision function lives here so tests don't need a real
 * clock or db. Caller passes `today` (or `now`) explicitly.
 */

export interface PredictiveLockInput {
  enabled: boolean;
  /** Org-local "today" — caller resolves the timezone. */
  today: Date;
  /** Affected shift's date in the same calendar zone as `today`. */
  scheduledDate: Date;
  /** Set true when the request includes ?force=true. */
  forceOverride: boolean;
  /** Window in days. Default 14 per the laws on the books. */
  windowDays?: number;
}

export interface PredictiveLockEvaluation {
  allowed: boolean;
  /** True when the change *would* have been blocked but force=true forced it through. */
  forcedThrough: boolean;
  /** Days from `today` to `scheduledDate` (negative = past). */
  noticeDays: number;
}

export function evaluatePredictiveLock(input: PredictiveLockInput): PredictiveLockEvaluation {
  const window = input.windowDays ?? 14;
  const noticeDays = daysBetween(input.today, input.scheduledDate);
  if (!input.enabled) {
    return { allowed: true, forcedThrough: false, noticeDays };
  }
  // Past dates pre-date the window (the law is forward-looking) —
  // historical corrections don't violate the notice rule.
  if (noticeDays < 0 || noticeDays >= window) {
    return { allowed: true, forcedThrough: false, noticeDays };
  }
  if (input.forceOverride) {
    return { allowed: true, forcedThrough: true, noticeDays };
  }
  return { allowed: false, forcedThrough: false, noticeDays };
}

/** Calendar-day difference between two dates (UTC-walked, DST-safe). */
function daysBetween(from: Date, to: Date): number {
  const a = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const b = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  return Math.round((b - a) / 86400000);
}
