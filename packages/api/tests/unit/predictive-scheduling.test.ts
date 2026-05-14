import { describe, it, expect } from '@jest/globals';
import { evaluatePredictiveLock } from '../../src/services/predictive-scheduling.service.js';

const TODAY = new Date('2026-06-01T12:00:00Z');

function dateUtc(yyyyMmDd: string): Date {
  const [y, m, d] = yyyyMmDd.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d));
}

describe('evaluatePredictiveLock()', () => {
  it('always allows when the feature is off', () => {
    const r = evaluatePredictiveLock({
      enabled: false,
      today: TODAY,
      scheduledDate: dateUtc('2026-06-02'),
      forceOverride: false,
    });
    expect(r.allowed).toBe(true);
    expect(r.forcedThrough).toBe(false);
    expect(r.noticeDays).toBe(1);
  });

  it('allows changes ≥ 14 days out', () => {
    const r = evaluatePredictiveLock({
      enabled: true,
      today: TODAY,
      scheduledDate: dateUtc('2026-06-15'), // exactly 14 days
      forceOverride: false,
    });
    expect(r.allowed).toBe(true);
    expect(r.noticeDays).toBe(14);
  });

  it('blocks changes inside the 14-day window', () => {
    const r = evaluatePredictiveLock({
      enabled: true,
      today: TODAY,
      scheduledDate: dateUtc('2026-06-10'), // 9 days notice
      forceOverride: false,
    });
    expect(r.allowed).toBe(false);
    expect(r.forcedThrough).toBe(false);
    expect(r.noticeDays).toBe(9);
  });

  it('allows blocked changes when forceOverride is true (and reports forcedThrough)', () => {
    const r = evaluatePredictiveLock({
      enabled: true,
      today: TODAY,
      scheduledDate: dateUtc('2026-06-05'), // 4 days notice
      forceOverride: true,
    });
    expect(r.allowed).toBe(true);
    expect(r.forcedThrough).toBe(true);
    expect(r.noticeDays).toBe(4);
  });

  it('does not lock historical changes — predictive notice is forward-looking', () => {
    const r = evaluatePredictiveLock({
      enabled: true,
      today: TODAY,
      scheduledDate: dateUtc('2026-05-20'), // 12 days ago
      forceOverride: false,
    });
    expect(r.noticeDays).toBe(-12);
    expect(r.allowed).toBe(true);
  });

  it('respects a custom windowDays override', () => {
    const r = evaluatePredictiveLock({
      enabled: true,
      today: TODAY,
      scheduledDate: dateUtc('2026-06-10'), // 9 days
      forceOverride: false,
      windowDays: 7,
    });
    expect(r.allowed).toBe(true);
    expect(r.noticeDays).toBe(9);
  });
});
