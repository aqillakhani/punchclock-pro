import { describe, it, expect } from '@jest/globals';
import { enumerateDates } from '../../src/services/time-off.service.js';

describe('enumerateDates()', () => {
  it('returns a single date when from === to', () => {
    expect(enumerateDates('2026-06-01', '2026-06-01')).toEqual(['2026-06-01']);
  });

  it('walks every day inclusive on both ends', () => {
    expect(enumerateDates('2026-06-01', '2026-06-05')).toEqual([
      '2026-06-01',
      '2026-06-02',
      '2026-06-03',
      '2026-06-04',
      '2026-06-05',
    ]);
  });

  it('crosses a month boundary correctly', () => {
    expect(enumerateDates('2026-05-30', '2026-06-02')).toEqual([
      '2026-05-30',
      '2026-05-31',
      '2026-06-01',
      '2026-06-02',
    ]);
  });

  it('does not insert or skip a day across DST transitions (UTC walk)', () => {
    // 2026 US DST start is 2026-03-08 (forward) and end 2026-11-01.
    // A naive local-time walk would drop one hour and miscount.
    const days = enumerateDates('2026-03-07', '2026-03-09');
    expect(days).toEqual(['2026-03-07', '2026-03-08', '2026-03-09']);
  });

  it('returns empty when end < start', () => {
    expect(enumerateDates('2026-06-05', '2026-06-01')).toEqual([]);
  });

  it('returns empty when either date is malformed', () => {
    expect(enumerateDates('not-a-date', '2026-06-01')).toEqual([]);
    expect(enumerateDates('2026-06-01', 'tomorrow')).toEqual([]);
  });
});
