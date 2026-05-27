import { describe, it, expect } from '@jest/globals';
import { isOrgSeedable, validateGeofenceEnv } from '../../src/db/prod-seed.js';

describe('isOrgSeedable()', () => {
  it('returns true when userCount is 0', () => {
    expect(isOrgSeedable(0)).toBe(true);
  });

  it('returns true when userCount is 1 (fresh org with owner only)', () => {
    expect(isOrgSeedable(1)).toBe(true);
  });

  it('returns false when userCount is 2', () => {
    expect(isOrgSeedable(2)).toBe(false);
  });

  it('returns false when userCount is 5', () => {
    expect(isOrgSeedable(5)).toBe(false);
  });

  it('returns false when userCount is larger', () => {
    expect(isOrgSeedable(100)).toBe(false);
  });
});

describe('validateGeofenceEnv()', () => {
  it('validates required env variables and returns config', () => {
    const config = validateGeofenceEnv({
      SEED_GEOFENCE_NAME: 'Main Store',
      SEED_GEOFENCE_LAT: '29.7407',
      SEED_GEOFENCE_LNG: '-95.4654',
      SEED_GEOFENCE_RADIUS_M: '150',
    });
    expect(config).toEqual({
      name: 'Main Store',
      latitude: 29.7407,
      longitude: -95.4654,
      radiusMeters: 150,
    });
  });

  it('uses default radius of 150m when SEED_GEOFENCE_RADIUS_M is not provided', () => {
    const config = validateGeofenceEnv({
      SEED_GEOFENCE_NAME: 'Main Store',
      SEED_GEOFENCE_LAT: '29.7407',
      SEED_GEOFENCE_LNG: '-95.4654',
    });
    expect(config.radiusMeters).toBe(150);
  });

  it('throws when SEED_GEOFENCE_NAME is missing', () => {
    expect(() =>
      validateGeofenceEnv({
        SEED_GEOFENCE_LAT: '29.7407',
        SEED_GEOFENCE_LNG: '-95.4654',
      }),
    ).toThrow(/SEED_GEOFENCE_NAME/);
  });

  it('throws when SEED_GEOFENCE_LAT is missing', () => {
    expect(() =>
      validateGeofenceEnv({
        SEED_GEOFENCE_NAME: 'Main Store',
        SEED_GEOFENCE_LNG: '-95.4654',
      }),
    ).toThrow(/SEED_GEOFENCE_LAT/);
  });

  it('throws when SEED_GEOFENCE_LNG is missing', () => {
    expect(() =>
      validateGeofenceEnv({
        SEED_GEOFENCE_NAME: 'Main Store',
        SEED_GEOFENCE_LAT: '29.7407',
      }),
    ).toThrow(/SEED_GEOFENCE_LNG/);
  });

  it('throws when SEED_GEOFENCE_LAT is non-numeric', () => {
    expect(() =>
      validateGeofenceEnv({
        SEED_GEOFENCE_NAME: 'Main Store',
        SEED_GEOFENCE_LAT: 'invalid',
        SEED_GEOFENCE_LNG: '-95.4654',
      }),
    ).toThrow(/SEED_GEOFENCE_LAT/);
  });

  it('throws when SEED_GEOFENCE_LNG is non-numeric', () => {
    expect(() =>
      validateGeofenceEnv({
        SEED_GEOFENCE_NAME: 'Main Store',
        SEED_GEOFENCE_LAT: '29.7407',
        SEED_GEOFENCE_LNG: 'invalid',
      }),
    ).toThrow(/SEED_GEOFENCE_LNG/);
  });

  it('throws when SEED_GEOFENCE_RADIUS_M is non-numeric', () => {
    expect(() =>
      validateGeofenceEnv({
        SEED_GEOFENCE_NAME: 'Main Store',
        SEED_GEOFENCE_LAT: '29.7407',
        SEED_GEOFENCE_LNG: '-95.4654',
        SEED_GEOFENCE_RADIUS_M: 'invalid',
      }),
    ).toThrow(/SEED_GEOFENCE_RADIUS_M/);
  });
});
