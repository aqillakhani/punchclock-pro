import { describe, it, expect } from '@jest/globals';
import { retentionCutoff } from '../../src/db/prune-audit-logs.js';

/**
 * Create a UTC date by specifying YYYY, MM (1-12), DD separately,
 * to avoid timezone offset issues with Date constructor.
 */
function utcDate(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

describe('retentionCutoff()', () => {
  it('returns a date 365 days in the past for default retention', () => {
    const ref = utcDate(2026, 5, 26);
    const cutoff = retentionCutoff(ref, 365);
    // 365 days before 2026-05-26 is 2025-05-26 (or 2025-05-27 depending on leap years)
    // More precisely: we subtract 365 days from May 26, 2026
    expect(cutoff.getUTCFullYear()).toBe(2025);
    expect(cutoff.getUTCMonth()).toBe(4); // May is month 4 (0-indexed)
    expect(cutoff.getUTCDate()).toBe(26);
  });

  it('returns a date 30 days in the past for minimum retention', () => {
    const ref = utcDate(2026, 5, 26);
    const cutoff = retentionCutoff(ref, 30);
    expect(cutoff.getUTCFullYear()).toBe(2026);
    expect(cutoff.getUTCMonth()).toBe(3); // April is month 3
    expect(cutoff.getUTCDate()).toBe(26);
  });

  it('returns a date 90 days in the past for custom retention', () => {
    const ref = utcDate(2026, 5, 26);
    const cutoff = retentionCutoff(ref, 90);
    // 90 days back from May 26 is approximately Feb 25-26
    expect(cutoff.getUTCFullYear()).toBe(2026);
    expect(cutoff.getUTCMonth()).toBe(1); // Feb is month 1
    expect(cutoff.getUTCDate()).toBeGreaterThanOrEqual(24);
    expect(cutoff.getUTCDate()).toBeLessThanOrEqual(26);
  });

  it('subtracts exactly the specified number of days', () => {
    const ref = utcDate(2026, 1, 10); // Jan 10
    const cutoff = retentionCutoff(ref, 5);
    // 5 days back from Jan 10 should be Jan 5
    expect(cutoff.getUTCFullYear()).toBe(2026);
    expect(cutoff.getUTCMonth()).toBe(0); // January
    expect(cutoff.getUTCDate()).toBe(5);
  });
});
