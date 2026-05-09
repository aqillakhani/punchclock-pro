import { describe, it, expect } from '@jest/globals';
import { calculateOvertime, type DailyHours } from '../../src/services/overtime.service.js';

describe('calculateOvertime (federal)', () => {
  const days = (...hours: number[]): DailyHours[] =>
    hours.map((h, i) => ({ date: `2026-04-${String(i + 1).padStart(2, '0')}`, hours: h }));

  it('returns zero OT for a 40-hour week', () => {
    const result = calculateOvertime(days(8, 8, 8, 8, 8), 'federal');
    expect(result).toEqual({ regularHours: 40, overtimeHours: 0, doubleTimeHours: 0 });
  });

  it('returns 10h OT for a 50-hour week', () => {
    const result = calculateOvertime(days(10, 10, 10, 10, 10), 'federal');
    expect(result).toEqual({ regularHours: 40, overtimeHours: 10, doubleTimeHours: 0 });
  });

  it('handles a short week with no OT', () => {
    const result = calculateOvertime(days(4, 4, 6), 'federal');
    expect(result).toEqual({ regularHours: 14, overtimeHours: 0, doubleTimeHours: 0 });
  });

  it('handles a very long week', () => {
    const result = calculateOvertime(days(14, 14, 14, 14, 14), 'federal');
    expect(result).toEqual({ regularHours: 40, overtimeHours: 30, doubleTimeHours: 0 });
  });
});

describe('calculateOvertime (california)', () => {
  const days = (...hours: number[]): DailyHours[] =>
    hours.map((h, i) => ({ date: `2026-04-${String(i + 1).padStart(2, '0')}`, hours: h }));

  it('applies daily OT over 8 hours', () => {
    // 9h day → 8 reg + 1 OT
    const result = calculateOvertime(days(9), 'california');
    expect(result).toEqual({ regularHours: 8, overtimeHours: 1, doubleTimeHours: 0 });
  });

  it('applies daily double time over 12 hours', () => {
    // 14h day → 8 reg + 4 OT + 2 DT
    const result = calculateOvertime(days(14), 'california');
    expect(result).toEqual({ regularHours: 8, overtimeHours: 4, doubleTimeHours: 2 });
  });

  it('applies weekly OT over 40 regular hours', () => {
    // 6 x 8h = 48h → 40 reg + 8 weekly OT
    const result = calculateOvertime(days(8, 8, 8, 8, 8, 8), 'california');
    expect(result).toEqual({ regularHours: 40, overtimeHours: 8, doubleTimeHours: 0 });
  });

  it('combines daily OT, weekly OT and double time', () => {
    // Mon 13 (8+4+1DT) Tue 8 Wed 8 Thu 8 Fri 8 Sat 8 = 53h raw
    // Daily pass: reg=8+8+8+8+8+8=48  ot=4  dt=1
    // Weekly pass on reg: reg=40, +8 weekly OT  ⇒ reg=40 ot=12 dt=1
    const result = calculateOvertime(days(13, 8, 8, 8, 8, 8), 'california');
    expect(result).toEqual({ regularHours: 40, overtimeHours: 12, doubleTimeHours: 1 });
  });
});
