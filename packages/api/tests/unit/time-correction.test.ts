import { describe, it, expect } from '@jest/globals';
import { computeMinutesDelta } from '../../src/services/time-correction.service.js';
import { normalizeIp, diffChanges } from '../../src/services/audit.service.js';

/**
 * `computeMinutesDelta` is what the approver sees before deciding — it
 * answers "how many minutes does saying yes add to payroll?". Getting
 * the sign or an open-shift case wrong would put a wrong number in front
 * of someone approving money, so it is covered directly.
 */
describe('computeMinutesDelta()', () => {
  const IN = '2026-03-02T09:00:00.000Z';
  const OUT = '2026-03-02T17:00:00.000Z';

  it('reports added minutes when the punch-out moves later', () => {
    expect(
      computeMinutesDelta({
        originalIn: IN,
        originalOut: OUT,
        requestedIn: null,
        requestedOut: '2026-03-02T18:00:00.000Z',
        requestType: 'edit_times',
      }),
    ).toBe(60);
  });

  it('reports removed minutes when the punch-out moves earlier', () => {
    expect(
      computeMinutesDelta({
        originalIn: IN,
        originalOut: OUT,
        requestedIn: null,
        requestedOut: '2026-03-02T16:30:00.000Z',
        requestType: 'edit_times',
      }),
    ).toBe(-30);
  });

  it('accounts for a later start as removed time', () => {
    expect(
      computeMinutesDelta({
        originalIn: IN,
        originalOut: OUT,
        requestedIn: '2026-03-02T10:00:00.000Z',
        requestedOut: null,
        requestType: 'edit_times',
      }),
    ).toBe(-60);
  });

  it('combines both ends moving', () => {
    expect(
      computeMinutesDelta({
        originalIn: IN,
        originalOut: OUT,
        requestedIn: '2026-03-02T08:00:00.000Z',
        requestedOut: '2026-03-02T18:00:00.000Z',
        requestType: 'edit_times',
      }),
    ).toBe(120);
  });

  it('is zero when the requested times match the original', () => {
    expect(
      computeMinutesDelta({
        originalIn: IN,
        originalOut: OUT,
        requestedIn: IN,
        requestedOut: OUT,
        requestType: 'edit_times',
      }),
    ).toBe(0);
  });

  it('counts a whole added shift as positive', () => {
    expect(
      computeMinutesDelta({
        originalIn: null,
        originalOut: null,
        requestedIn: IN,
        requestedOut: OUT,
        requestType: 'add_entry',
      }),
    ).toBe(480);
  });

  it('counts a deletion as the negative of the original shift', () => {
    expect(
      computeMinutesDelta({
        originalIn: IN,
        originalOut: OUT,
        requestedIn: null,
        requestedOut: null,
        requestType: 'delete_entry',
      }),
    ).toBe(-480);
  });

  it('returns null when the shift is still open and no end is proposed', () => {
    expect(
      computeMinutesDelta({
        originalIn: IN,
        originalOut: null,
        requestedIn: '2026-03-02T08:00:00.000Z',
        requestedOut: null,
        requestType: 'edit_times',
      }),
    ).toBeNull();
  });

  it('returns null rather than NaN on an unparseable timestamp', () => {
    expect(
      computeMinutesDelta({
        originalIn: IN,
        originalOut: 'not-a-date',
        requestedIn: null,
        requestedOut: OUT,
        requestType: 'edit_times',
      }),
    ).toBeNull();
  });

  it('handles a deletion of a still-open shift', () => {
    expect(
      computeMinutesDelta({
        originalIn: IN,
        originalOut: null,
        requestedIn: null,
        requestedOut: null,
        requestType: 'delete_entry',
      }),
    ).toBeNull();
  });
});

/**
 * A malformed IP must never be the reason a worker cannot clock in —
 * `ip_address` is an INET column and Postgres rejects junk outright.
 */
describe('normalizeIp()', () => {
  it.each([
    ['192.168.1.10', '192.168.1.10'],
    ['::ffff:127.0.0.1', '::ffff:127.0.0.1'],
    ['::1', '::1'],
    ['2001:db8::8a2e:370:7334', '2001:db8::8a2e:370:7334'],
  ])('keeps %s', (input, expected) => {
    expect(normalizeIp(input)).toBe(expected);
  });

  it.each([
    [null],
    [undefined],
    [''],
    ['   '],
    ['not-an-ip'],
    ['999.999.999.999'],
    ['192.168.1.10; DROP TABLE users'],
    ['<script>alert(1)</script>'],
  ])('drops %s', (input) => {
    expect(normalizeIp(input as string | null | undefined)).toBeNull();
  });

  it('drops an absurdly long value', () => {
    expect(normalizeIp('1'.repeat(200))).toBeNull();
  });
});

describe('diffChanges()', () => {
  it('includes only the keys that actually moved', () => {
    expect(
      diffChanges(
        { punchInAt: '09:00', punchOutAt: '17:00', notes: 'same' },
        { punchInAt: '09:00', punchOutAt: '18:00', notes: 'same' },
      ),
    ).toEqual({ before: { punchOutAt: '17:00' }, after: { punchOutAt: '18:00' } });
  });

  it('is empty when nothing changed', () => {
    expect(diffChanges({ a: 1 }, { a: 1 })).toEqual({ before: {}, after: {} });
  });

  it('normalizes an appearing or disappearing key to null', () => {
    expect(diffChanges({ a: undefined }, { a: 'set' })).toEqual({
      before: { a: null },
      after: { a: 'set' },
    });
    expect(diffChanges({ a: 'set' }, {})).toEqual({ before: { a: 'set' }, after: { a: null } });
  });
});
