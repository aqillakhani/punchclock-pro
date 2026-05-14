import { describe, it, expect } from '@jest/globals';
import { ERROR_CODES, HTTP_STATUS } from '@punchclock/shared';
import { evaluateCaps } from '../../src/services/caps.service.js';
import { AppError } from '../../src/lib/errors.js';

const NOW = new Date('2026-05-13T15:00:00Z');

const BASELINE = {
  workerType: 'W2' as const,
  enforcement: 'block' as const,
  maxDailyMinutes: 480, // 8h
  maxWeeklyMinutes: 2400, // 40h
  capExemptUntil: null,
  now: NOW,
};

describe('evaluateCaps()', () => {
  // --- The four required cases from plan A4 ---

  it('blocks the punch when daily cap is reached (block mode)', () => {
    const result = evaluateCaps({
      ...BASELINE,
      todayMinutes: 480, // exactly at cap
      weekMinutes: 1200,
    });
    expect(result.allowed).toBe(false);
    expect(result.blockReason).toEqual({ scope: 'daily', cap: 480, current: 480 });
    expect(result.warnings).toEqual([]);
  });

  it('blocks the punch when weekly cap is reached (block mode)', () => {
    const result = evaluateCaps({
      ...BASELINE,
      todayMinutes: 0,
      weekMinutes: 2400, // exactly at week cap
    });
    expect(result.allowed).toBe(false);
    expect(result.blockReason).toEqual({ scope: 'weekly', cap: 2400, current: 2400 });
    expect(result.warnings).toEqual([]);
  });

  it('returns a warning instead of blocking when enforcement=warn', () => {
    const result = evaluateCaps({
      ...BASELINE,
      enforcement: 'warn',
      todayMinutes: 540, // 9h — over 8h cap
      weekMinutes: 1800,
    });
    expect(result.allowed).toBe(true);
    expect(result.blockReason).toBeUndefined();
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatchObject({
      scope: 'daily',
      cap: 480,
      current: 540,
    });
    expect(result.warnings[0]?.message).toContain('Daily 8-hour cap');
  });

  it('skips the cap check when cap_exempt_until is in the future (manager override)', () => {
    const result = evaluateCaps({
      ...BASELINE,
      todayMinutes: 600, // would normally block
      weekMinutes: 3000, // would also block
      capExemptUntil: new Date(NOW.getTime() + 3 * 60 * 60 * 1000), // 3h from now
    });
    expect(result.allowed).toBe(true);
    expect(result.blockReason).toBeUndefined();
    expect(result.warnings).toEqual([]);
  });

  // --- Additional edge cases worth nailing down ---

  it('does not enforce caps for 1099 contractors', () => {
    const result = evaluateCaps({
      ...BASELINE,
      workerType: 'contractor_1099',
      todayMinutes: 600,
      weekMinutes: 3000,
    });
    expect(result.allowed).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it('short-circuits when enforcement=off', () => {
    const result = evaluateCaps({
      ...BASELINE,
      enforcement: 'off',
      todayMinutes: 9999,
      weekMinutes: 9999,
    });
    expect(result.allowed).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it('allows the punch when both totals are under the cap', () => {
    const result = evaluateCaps({
      ...BASELINE,
      todayMinutes: 240, // 4h
      weekMinutes: 1200, // 20h
    });
    expect(result.allowed).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it('treats an expired cap_exempt_until as no exemption', () => {
    const result = evaluateCaps({
      ...BASELINE,
      todayMinutes: 480,
      weekMinutes: 1200,
      capExemptUntil: new Date(NOW.getTime() - 60 * 1000), // 1 min ago
    });
    expect(result.allowed).toBe(false);
    expect(result.blockReason?.scope).toBe('daily');
  });

  it('blocks daily before checking weekly when both are over (deterministic order)', () => {
    const result = evaluateCaps({
      ...BASELINE,
      todayMinutes: 480,
      weekMinutes: 2400,
    });
    expect(result.allowed).toBe(false);
    expect(result.blockReason?.scope).toBe('daily');
  });

  it('emits both daily and weekly warnings in warn mode when both exceed', () => {
    const result = evaluateCaps({
      ...BASELINE,
      enforcement: 'warn',
      todayMinutes: 540,
      weekMinutes: 2500,
    });
    expect(result.allowed).toBe(true);
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings.map((w) => w.scope).sort()).toEqual(['daily', 'weekly']);
  });
});

describe('AppError.capExceeded', () => {
  it('produces a 409 with CAP_EXCEEDED code and a friendly message', () => {
    const e = AppError.capExceeded({ scope: 'daily', cap: 480, current: 510 });
    expect(e.statusCode).toBe(HTTP_STATUS.CONFLICT);
    expect(e.code).toBe(ERROR_CODES.CAP_EXCEEDED);
    expect(e.message).toBe('Daily 8-hour cap reached');
    expect(e.details).toEqual({ scope: 'daily', cap: 480, current: 510 });
  });

  it('uses the weekly label for weekly scope', () => {
    const e = AppError.capExceeded({ scope: 'weekly', cap: 2400, current: 2400 });
    expect(e.message).toBe('Weekly 40-hour cap reached');
  });

  it('renders fractional cap hours with one decimal', () => {
    const e = AppError.capExceeded({ scope: 'daily', cap: 510, current: 510 });
    expect(e.message).toBe('Daily 8.5-hour cap reached');
  });
});
