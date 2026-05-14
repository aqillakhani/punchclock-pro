import { describe, it, expect } from '@jest/globals';
import { evaluateScheduleConflict } from '../../src/services/schedule-conflicts.service.js';

const BASE = {
  proposed: { scheduledDate: '2026-06-15', shiftStart: '09:00', shiftEnd: '17:00' },
  existingOnDate: [],
  weekScheduledMinutes: 0,
  maxWeeklyMinutes: 2400,
  previousShiftEndIso: null,
};

describe('evaluateScheduleConflict()', () => {
  it('returns null on a clean slot', () => {
    expect(evaluateScheduleConflict(BASE).conflict).toBeNull();
  });

  it('detects overlap with another shift on the same date', () => {
    const r = evaluateScheduleConflict({
      ...BASE,
      existingOnDate: [
        {
          scheduledDate: '2026-06-15',
          shiftStart: '12:00',
          shiftEnd: '20:00',
          durationMinutes: 480,
        },
      ],
    });
    expect(r.conflict).toBe('overlap');
    expect(r.message).toMatch(/Overlaps/);
  });

  it('does not flag back-to-back shifts (no time intersection)', () => {
    const r = evaluateScheduleConflict({
      ...BASE,
      existingOnDate: [
        {
          scheduledDate: '2026-06-15',
          shiftStart: '17:00',
          shiftEnd: '23:00',
          durationMinutes: 360,
        },
      ],
    });
    expect(r.conflict).toBeNull();
  });

  it('detects weekly cap when proposed pushes total > max', () => {
    const r = evaluateScheduleConflict({
      ...BASE,
      weekScheduledMinutes: 2100, // 35h existing
      // proposed = 8h (480 min) → 43h, > 40h cap
    });
    expect(r.conflict).toBe('weekly_cap');
  });

  it('does not flag when projected week is exactly at cap', () => {
    const r = evaluateScheduleConflict({
      ...BASE,
      weekScheduledMinutes: 1920, // 32h existing → +8h = 40h exactly
    });
    expect(r.conflict).toBeNull();
  });

  it('detects rest-period conflict when previous shift ended < 10h ago', () => {
    const r = evaluateScheduleConflict({
      ...BASE,
      previousShiftEndIso: '2026-06-15T03:00:00Z', // 6h before 09:00 start
    });
    expect(r.conflict).toBe('rest_period');
  });

  it('respects custom restWindowHours', () => {
    const r = evaluateScheduleConflict({
      ...BASE,
      previousShiftEndIso: '2026-06-15T03:00:00Z',
      restWindowHours: 4,
    });
    expect(r.conflict).toBeNull();
  });

  it('overlap takes priority over weekly cap when both would fire', () => {
    const r = evaluateScheduleConflict({
      ...BASE,
      weekScheduledMinutes: 2100,
      existingOnDate: [
        {
          scheduledDate: '2026-06-15',
          shiftStart: '08:00',
          shiftEnd: '16:00',
          durationMinutes: 480,
        },
      ],
    });
    expect(r.conflict).toBe('overlap');
  });
});
