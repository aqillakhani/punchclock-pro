import { describe, it, expect } from '@jest/globals';
import {
  generateResetToken,
  hashToken,
  resetTokenExpiry,
  isTokenUsable,
} from '../../src/services/password-reset.service.js';

describe('generateResetToken()', () => {
  it('produces a long, URL-safe token', () => {
    const t = generateResetToken();
    expect(t.length).toBeGreaterThanOrEqual(32);
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('is unguessable — a new value each call', () => {
    expect(generateResetToken()).not.toBe(generateResetToken());
  });
});

describe('hashToken()', () => {
  it('is a deterministic 64-char hex SHA-256', () => {
    expect(hashToken('abc')).toBe(hashToken('abc'));
    expect(hashToken('abc')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('differs for different inputs', () => {
    expect(hashToken('abc')).not.toBe(hashToken('abd'));
  });
});

describe('resetTokenExpiry()', () => {
  it('adds the TTL minutes to the given time', () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    expect(resetTokenExpiry(now, 15).toISOString()).toBe('2026-01-01T00:15:00.000Z');
  });

  it('defaults to a 15-minute TTL', () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    expect(resetTokenExpiry(now).toISOString()).toBe('2026-01-01T00:15:00.000Z');
  });
});

describe('isTokenUsable()', () => {
  const now = new Date('2026-01-01T12:00:00.000Z');

  it('true when not yet expired and not used', () => {
    expect(isTokenUsable({ expires_at: '2026-01-01T12:10:00Z', used_at: null }, now)).toBe(true);
  });

  it('false once expired', () => {
    expect(isTokenUsable({ expires_at: '2026-01-01T11:50:00Z', used_at: null }, now)).toBe(false);
  });

  it('false once already used (single-use)', () => {
    expect(
      isTokenUsable({ expires_at: '2026-01-01T12:10:00Z', used_at: '2026-01-01T11:30:00Z' }, now),
    ).toBe(false);
  });
});
