import { describe, it, expect } from '@jest/globals';
import { haversineMeters } from '../../src/services/geofence.service.js';

describe('haversineMeters', () => {
  it('returns 0 for identical points', () => {
    const d = haversineMeters(
      { latitude: 40.7128, longitude: -74.006 },
      { latitude: 40.7128, longitude: -74.006 },
    );
    expect(d).toBeCloseTo(0, 3);
  });

  it('approximates ~111 km per degree of latitude at the equator', () => {
    const d = haversineMeters(
      { latitude: 0, longitude: 0 },
      { latitude: 1, longitude: 0 },
    );
    // Actual value ~111_195 m.
    expect(d).toBeGreaterThan(110_000);
    expect(d).toBeLessThan(112_000);
  });

  it('handles short urban distances within tolerance', () => {
    // Two points ~500m apart in NYC.
    const d = haversineMeters(
      { latitude: 40.7128, longitude: -74.006 },
      { latitude: 40.7173, longitude: -74.006 },
    );
    expect(d).toBeGreaterThan(490);
    expect(d).toBeLessThan(510);
  });
});
