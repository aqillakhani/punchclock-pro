import { describe, it, expect } from '@jest/globals';
import { evaluateMealBreak } from '../../src/services/meal-break.service.js';

describe('evaluateMealBreak()', () => {
  // --- Universal "missing meal break" warning ---

  it('flags a >6h onshore shift with no meal break', () => {
    const r = evaluateMealBreak({
      shiftMinutes: 7 * 60,
      mealBreakMinutes: 0,
      worksite: 'onshore',
      orgTimezone: 'America/Chicago',
    });
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]?.code).toBe('missing_meal_break');
  });

  it('does not flag a 6h shift with no meal break (>6 is the threshold)', () => {
    const r = evaluateMealBreak({
      shiftMinutes: 360,
      mealBreakMinutes: 0,
      worksite: 'onshore',
      orgTimezone: 'America/Chicago',
    });
    expect(r.warnings).toEqual([]);
  });

  it('does not flag when a meal break was taken', () => {
    const r = evaluateMealBreak({
      shiftMinutes: 8 * 60,
      mealBreakMinutes: 30,
      worksite: 'onshore',
      orgTimezone: 'America/Chicago',
    });
    expect(r.warnings).toEqual([]);
  });

  // --- California enforcement (≥5h => required 30 min) ---

  it('flags a CA onshore shift ≥5h with no meal break', () => {
    const r = evaluateMealBreak({
      shiftMinutes: 5 * 60,
      mealBreakMinutes: 0,
      worksite: 'onshore',
      orgTimezone: 'America/Los_Angeles',
    });
    const codes = r.warnings.map((w) => w.code);
    expect(codes).toContain('ca_meal_break_violation');
  });

  it('flags a CA onshore shift ≥5h with a short (<30min) meal break', () => {
    const r = evaluateMealBreak({
      shiftMinutes: 6 * 60,
      mealBreakMinutes: 15,
      worksite: 'onshore',
      orgTimezone: 'America/Los_Angeles',
    });
    const ca = r.warnings.find((w) => w.code === 'ca_meal_break_violation');
    expect(ca).toBeDefined();
    expect(ca?.requiredMinutes).toBe(30);
    expect(ca?.actualMinutes).toBe(15);
  });

  it('does not flag a CA shift just under 5h', () => {
    const r = evaluateMealBreak({
      shiftMinutes: 4 * 60 + 59,
      mealBreakMinutes: 0,
      worksite: 'onshore',
      orgTimezone: 'America/Los_Angeles',
    });
    expect(r.warnings).toEqual([]);
  });

  // --- Offshore exemption ---

  it('skips all rules for offshore contractors', () => {
    const r = evaluateMealBreak({
      shiftMinutes: 10 * 60,
      mealBreakMinutes: 0,
      worksite: 'offshore',
      orgTimezone: 'America/Los_Angeles',
    });
    expect(r.warnings).toEqual([]);
  });
});
