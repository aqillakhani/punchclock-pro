import { describe, it, expect } from '@jest/globals';
import { payPeriodFor, recentPayPeriods } from '../../src/services/pay-period.service.js';
import { autoClockOutAt } from '../../src/services/auto-clock-out.service.js';

/**
 * Every lock decision rests on these boundaries. Getting one wrong means
 * either refusing an edit that should be allowed, or — worse — permitting
 * a change to a period payroll has already paid.
 */
describe('payPeriodFor()', () => {
  describe('weekly', () => {
    const config = { type: 'weekly' as const, anchor: '2026-01-05' }; // a Monday

    it('returns the anchor week for the anchor itself', () => {
      expect(payPeriodFor('2026-01-05', config)).toEqual({
        startDate: '2026-01-05',
        endDate: '2026-01-11',
      });
    });

    it('includes the last day of the week', () => {
      expect(payPeriodFor('2026-01-11', config)).toEqual({
        startDate: '2026-01-05',
        endDate: '2026-01-11',
      });
    });

    it('rolls to the next week on the boundary', () => {
      expect(payPeriodFor('2026-01-12', config).startDate).toBe('2026-01-12');
    });

    it('handles dates far after the anchor', () => {
      expect(payPeriodFor('2026-07-29', config)).toEqual({
        startDate: '2026-07-27',
        endDate: '2026-08-02',
      });
    });

    // The bug a naive `Math.trunc` would introduce: everything before the
    // anchor collapsing onto the anchor period.
    it('handles dates BEFORE the anchor', () => {
      expect(payPeriodFor('2026-01-04', config)).toEqual({
        startDate: '2025-12-29',
        endDate: '2026-01-04',
      });
      expect(payPeriodFor('2025-12-29', config).startDate).toBe('2025-12-29');
      expect(payPeriodFor('2025-12-28', config).startDate).toBe('2025-12-22');
    });
  });

  describe('biweekly', () => {
    const config = { type: 'biweekly' as const, anchor: '2026-01-05' };

    it('spans fourteen days', () => {
      expect(payPeriodFor('2026-01-05', config)).toEqual({
        startDate: '2026-01-05',
        endDate: '2026-01-18',
      });
    });

    it('keeps day 14 inside and day 15 outside', () => {
      expect(payPeriodFor('2026-01-18', config).startDate).toBe('2026-01-05');
      expect(payPeriodFor('2026-01-19', config).startDate).toBe('2026-01-19');
    });

    it('works before the anchor', () => {
      expect(payPeriodFor('2026-01-04', config)).toEqual({
        startDate: '2025-12-22',
        endDate: '2026-01-04',
      });
    });
  });

  describe('semimonthly', () => {
    const config = { type: 'semimonthly' as const, anchor: '2026-01-01' };

    it('splits the month at the 16th', () => {
      expect(payPeriodFor('2026-03-01', config)).toEqual({
        startDate: '2026-03-01',
        endDate: '2026-03-15',
      });
      expect(payPeriodFor('2026-03-15', config).endDate).toBe('2026-03-15');
      expect(payPeriodFor('2026-03-16', config)).toEqual({
        startDate: '2026-03-16',
        endDate: '2026-03-31',
      });
    });

    it('ends February on the 28th in a common year', () => {
      expect(payPeriodFor('2026-02-20', config).endDate).toBe('2026-02-28');
    });

    it('ends February on the 29th in a leap year', () => {
      expect(payPeriodFor('2028-02-20', config).endDate).toBe('2028-02-29');
    });

    it('handles a 30-day month', () => {
      expect(payPeriodFor('2026-04-30', config)).toEqual({
        startDate: '2026-04-16',
        endDate: '2026-04-30',
      });
    });
  });

  describe('monthly', () => {
    const config = { type: 'monthly' as const, anchor: '2026-01-01' };

    it('covers the whole calendar month', () => {
      expect(payPeriodFor('2026-01-17', config)).toEqual({
        startDate: '2026-01-01',
        endDate: '2026-01-31',
      });
    });

    it('handles December without rolling the year', () => {
      expect(payPeriodFor('2026-12-31', config)).toEqual({
        startDate: '2026-12-01',
        endDate: '2026-12-31',
      });
    });
  });

  it('is stable across a DST transition', () => {
    // US DST starts 2026-03-08. Date-only maths must not gain or lose a
    // day, which it would if it were done in local time.
    const config = { type: 'weekly' as const, anchor: '2026-03-02' };
    expect(payPeriodFor('2026-03-08', config)).toEqual({
      startDate: '2026-03-02',
      endDate: '2026-03-08',
    });
    expect(payPeriodFor('2026-03-09', config).startDate).toBe('2026-03-09');
  });

  it('never returns a period whose end precedes its start', () => {
    const configs = [
      { type: 'weekly' as const, anchor: '2026-01-05' },
      { type: 'biweekly' as const, anchor: '2026-01-05' },
      { type: 'semimonthly' as const, anchor: '2026-01-01' },
      { type: 'monthly' as const, anchor: '2026-01-01' },
    ];
    for (const config of configs) {
      for (let day = 1; day <= 28; day++) {
        const date = `2026-02-${String(day).padStart(2, '0')}`;
        const p = payPeriodFor(date, config);
        expect(p.endDate >= p.startDate).toBe(true);
        // And the date must actually fall inside its own period.
        expect(date >= p.startDate && date <= p.endDate).toBe(true);
      }
    }
  });
});

describe('recentPayPeriods()', () => {
  const config = { type: 'weekly' as const, anchor: '2026-01-05' };

  it('returns consecutive, non-overlapping periods newest first', () => {
    const periods = recentPayPeriods('2026-07-29', config, 4);
    expect(periods).toHaveLength(4);
    expect(periods[0]!.startDate).toBe('2026-07-27');
    for (let i = 1; i < periods.length; i++) {
      // Each period ends exactly the day before the newer one starts.
      const gapDays =
        (Date.parse(`${periods[i - 1]!.startDate}T00:00:00Z`) -
          Date.parse(`${periods[i]!.endDate}T00:00:00Z`)) /
        86_400_000;
      expect(gapDays).toBe(1);
    }
  });

  it('includes the period containing today', () => {
    const [first] = recentPayPeriods('2026-07-29', config, 1);
    expect('2026-07-29' >= first!.startDate && '2026-07-29' <= first!.endDate).toBe(true);
  });
});

/**
 * The close time is derived from the punch-in, never from when the sweep
 * runs — otherwise a job that fires late pays for the delay.
 */
describe('autoClockOutAt()', () => {
  it('caps at punch-in plus the configured minutes', () => {
    expect(autoClockOutAt('2026-03-02T09:00:00.000Z', 720).toISOString()).toBe(
      '2026-03-02T21:00:00.000Z',
    );
  });

  it('does not depend on the current time', () => {
    const a = autoClockOutAt('2026-03-02T09:00:00.000Z', 600);
    const b = autoClockOutAt(new Date('2026-03-02T09:00:00.000Z'), 600);
    expect(a.toISOString()).toBe(b.toISOString());
  });

  it('crosses midnight correctly', () => {
    expect(autoClockOutAt('2026-03-02T20:00:00.000Z', 480).toISOString()).toBe(
      '2026-03-03T04:00:00.000Z',
    );
  });
});
